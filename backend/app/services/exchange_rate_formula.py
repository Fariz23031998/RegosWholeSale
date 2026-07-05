from __future__ import annotations

import ast
import math
import operator
from typing import Any

from app.core.exceptions import bad_request

REGOS_MAX_EXCHANGE_RATE = 9_999_999_999.99999999
DEFAULT_PREVIEW_RATE = 1000.0

_ALLOWED_BINOPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
}
_ALLOWED_UNARYOPS = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}
_ALLOWED_FUNCTIONS: dict[str, tuple[int, int]] = {
    "round": (1, 2),
    "floor": (1, 2),
    "ceil": (1, 2),
}
_MAX_ROUND_DECIMALS = 8


def validate_formula(formula: str) -> None:
    normalized = _normalize_formula(formula)
    if not normalized:
        raise bad_request("Formula cannot be empty.", "EXCHANGE_RATE_FORMULA_INVALID")
    try:
        tree = ast.parse(normalized, mode="eval")
    except SyntaxError as exc:
        raise bad_request(
            "Invalid exchange rate formula syntax.",
            "EXCHANGE_RATE_FORMULA_INVALID",
        ) from exc
    _validate_ast_node(tree.body)


def apply_formula(formula: str, exchange_rate: float) -> float:
    validate_formula(formula)
    normalized = _normalize_formula(formula)
    tree = ast.parse(normalized, mode="eval")
    result = _evaluate_ast_node(tree.body, exchange_rate)
    return _validate_result(result)


def preview_formula(formula: str, sample_rate: float = DEFAULT_PREVIEW_RATE) -> float:
    if sample_rate <= 0:
        raise bad_request(
            "Sample exchange rate must be greater than zero.",
            "EXCHANGE_RATE_FORMULA_INVALID",
        )
    return apply_formula(formula, sample_rate)


def _normalize_formula(formula: str) -> str:
    return formula.strip()


def _validate_ast_node(node: ast.AST) -> None:
    if isinstance(node, ast.Constant):
        if not isinstance(node.value, (int, float)):
            raise bad_request(
                "Formula may only contain numeric constants.",
                "EXCHANGE_RATE_FORMULA_INVALID",
            )
        return

    if isinstance(node, ast.Name):
        if node.id != "exchange_rate":
            raise bad_request(
                "Formula may only use the exchange_rate variable.",
                "EXCHANGE_RATE_FORMULA_INVALID",
            )
        return

    if isinstance(node, ast.BinOp):
        if type(node.op) not in _ALLOWED_BINOPS:
            raise bad_request(
                "Formula supports only +, -, *, and / operators.",
                "EXCHANGE_RATE_FORMULA_INVALID",
            )
        _validate_ast_node(node.left)
        _validate_ast_node(node.right)
        return

    if isinstance(node, ast.UnaryOp):
        if type(node.op) not in _ALLOWED_UNARYOPS:
            raise bad_request(
                "Formula supports only unary + and - operators.",
                "EXCHANGE_RATE_FORMULA_INVALID",
            )
        _validate_ast_node(node.operand)
        return

    if isinstance(node, ast.Call):
        _validate_call_node(node)
        return

    raise bad_request(
        "Formula contains unsupported syntax.",
        "EXCHANGE_RATE_FORMULA_INVALID",
    )


def _validate_call_node(node: ast.Call) -> None:
    if node.keywords:
        raise bad_request(
            "Formula function calls do not support keyword arguments.",
            "EXCHANGE_RATE_FORMULA_INVALID",
        )
    if not isinstance(node.func, ast.Name):
        raise bad_request(
            "Formula supports only round(), floor(), and ceil() functions.",
            "EXCHANGE_RATE_FORMULA_INVALID",
        )

    function_name = node.func.id
    arg_limits = _ALLOWED_FUNCTIONS.get(function_name)
    if arg_limits is None:
        raise bad_request(
            "Formula supports only round(), floor(), and ceil() functions.",
            "EXCHANGE_RATE_FORMULA_INVALID",
        )

    min_args, max_args = arg_limits
    if not min_args <= len(node.args) <= max_args:
        raise bad_request(
            f"Function {function_name}() received an invalid number of arguments.",
            "EXCHANGE_RATE_FORMULA_INVALID",
        )

    _validate_ast_node(node.args[0])
    if len(node.args) == 2:
        _validate_decimals_argument(node.args[1], function_name=function_name)
        return

    for arg in node.args[1:]:
        _validate_ast_node(arg)


def _validate_decimals_argument(node: ast.AST, *, function_name: str) -> None:
    if not isinstance(node, ast.Constant) or not isinstance(node.value, int):
        raise bad_request(
            f"{function_name}() decimal places must be a whole number.",
            "EXCHANGE_RATE_FORMULA_INVALID",
        )
    if node.value < 0 or node.value > _MAX_ROUND_DECIMALS:
        raise bad_request(
            f"{function_name}() decimal places must be between 0 and {_MAX_ROUND_DECIMALS}.",
            "EXCHANGE_RATE_FORMULA_INVALID",
        )


def _evaluate_ast_node(node: ast.AST, exchange_rate: float) -> float:
    if isinstance(node, ast.Constant):
        return float(node.value)

    if isinstance(node, ast.Name):
        return float(exchange_rate)

    if isinstance(node, ast.BinOp):
        left = _evaluate_ast_node(node.left, exchange_rate)
        right = _evaluate_ast_node(node.right, exchange_rate)
        if isinstance(node.op, ast.Div) and right == 0:
            raise bad_request(
                "Formula division by zero is not allowed.",
                "EXCHANGE_RATE_FORMULA_INVALID",
            )
        operator_fn = _ALLOWED_BINOPS[type(node.op)]
        return float(operator_fn(left, right))

    if isinstance(node, ast.UnaryOp):
        operand = _evaluate_ast_node(node.operand, exchange_rate)
        operator_fn = _ALLOWED_UNARYOPS[type(node.op)]
        return float(operator_fn(operand))

    if isinstance(node, ast.Call):
        return _evaluate_call_node(node, exchange_rate)

    raise bad_request(
        "Formula contains unsupported syntax.",
        "EXCHANGE_RATE_FORMULA_INVALID",
    )


def _evaluate_call_node(node: ast.Call, exchange_rate: float) -> float:
    function_name = node.func.id
    value = _evaluate_ast_node(node.args[0], exchange_rate)
    decimals = int(node.args[1].value) if len(node.args) == 2 else 0

    if function_name == "round":
        return float(_round_value(value, decimals))
    if function_name == "floor":
        return float(_floor_value(value, decimals))
    if function_name == "ceil":
        return float(_ceil_value(value, decimals))

    raise bad_request(
        "Formula supports only round(), floor(), and ceil() functions.",
        "EXCHANGE_RATE_FORMULA_INVALID",
    )


def _round_value(value: float, decimals: int = 0) -> float:
    if decimals <= 0:
        multiplier = 1.0
    else:
        multiplier = 10**decimals
    scaled = value * multiplier
    if scaled >= 0:
        rounded = math.floor(scaled + 0.5)
    else:
        rounded = math.ceil(scaled - 0.5)
    return rounded / multiplier


def _floor_value(value: float, decimals: int = 0) -> float:
    multiplier = 1.0 if decimals <= 0 else 10**decimals
    return math.floor(value * multiplier) / multiplier


def _ceil_value(value: float, decimals: int = 0) -> float:
    multiplier = 1.0 if decimals <= 0 else 10**decimals
    return math.ceil(value * multiplier) / multiplier


def _validate_result(value: Any) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise bad_request(
            "Formula did not produce a valid number.",
            "EXCHANGE_RATE_FORMULA_INVALID",
        ) from exc
    if not math.isfinite(result):
        raise bad_request(
            "Formula produced a non-finite number.",
            "EXCHANGE_RATE_FORMULA_INVALID",
        )
    if result <= 0:
        raise bad_request(
            "Formula result must be greater than zero.",
            "EXCHANGE_RATE_FORMULA_INVALID",
        )
    if result > REGOS_MAX_EXCHANGE_RATE:
        raise bad_request(
            "Formula result exceeds the maximum allowed exchange rate.",
            "EXCHANGE_RATE_FORMULA_INVALID",
        )
    return round(result, 8)
