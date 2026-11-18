from app.services.partner_notification_templates import (
    expand_conditionals,
    format_balance_line_notification,
    format_document_notification,
    format_payment_notification_template,
    resolve_balance_for_firm_currency,
    template_needs_balance,
)


def test_template_needs_balance_detects_placeholders():
    assert template_needs_balance("Hello {{partner_name}}") is False
    assert template_needs_balance("Bal {{balance}}") is True
    assert template_needs_balance("{{#if balance}}Debt{{/if}}") is True
    assert template_needs_balance("{{firm_name}} / {{currency_name}}") is False


def test_resolve_balance_for_firm_currency_uses_latest_row():
    rows = [
        {
            "id": 1,
            "date": 10,
            "firm": {"id": 4, "name": "Main"},
            "currency": {"id": 1, "name": "UZS"},
            "end_amount": 100,
        },
        {
            "id": 2,
            "date": 20,
            "firm": {"id": 4, "name": "Main"},
            "currency": {"id": 1, "name": "UZS"},
            "end_amount": 250.5,
        },
        {
            "id": 3,
            "date": 30,
            "firm": {"id": 5, "name": "Other"},
            "currency": {"id": 1, "name": "UZS"},
            "end_amount": 999,
        },
    ]
    firm, currency, amount = resolve_balance_for_firm_currency(
        rows,
        firm_id=4,
        currency_id=1,
        firm_name="Fallback Firm",
        currency_name="Fallback Cur",
    )
    assert firm == "Main"
    assert currency == "UZS"
    assert amount == 250.5

    firm, currency, amount = resolve_balance_for_firm_currency(
        rows,
        firm_id=99,
        currency_id=1,
        firm_name="Doc Firm",
        currency_name="Doc Cur",
    )
    assert firm == "Doc Firm"
    assert currency == "Doc Cur"
    assert amount == 0.0


def test_document_template_placeholders():
    text = format_document_notification(
        {
            "code": "WS-9",
            "date": 1_700_000_000,
            "currency": {"id": 1, "name": "UZS"},
            "exchange_rate": 1,
            "partner": {"id": 15, "name": "Acme"},
            "firm": {"id": 4, "name": "Main"},
        },
        [{"item": {"name": "Rice"}, "quantity": 2, "price": 10}],
        "Warehouse A",
        is_cancelled=False,
        is_return=False,
        use_cost=False,
        lang="en",
        template=(
            "{{partner_name}} {{document_code}} {{warehouse}} "
            "{{balance}}\n{{items}}\nTotal {{total}}"
        ),
        partner_id=15,
        partner_name="Acme",
        firm_name="Main",
        currency_name="UZS",
        balance=1234,
    )
    assert "Acme WS-9 Warehouse A 1 234" in text
    assert "{{firm_name}}" not in text
    assert "Rice" in text
    assert "Total 20" in text


def test_document_template_does_not_expand_firm_currency_placeholders():
    text = format_document_notification(
        {
            "code": "WS-9",
            "date": 1_700_000_000,
            "currency": {"id": 1, "name": "UZS"},
            "partner": {"id": 15, "name": "Acme"},
            "firm": {"id": 4, "name": "Main"},
        },
        [{"item": {"name": "Rice"}, "quantity": 1, "price": 10}],
        "Warehouse A",
        is_cancelled=False,
        is_return=False,
        use_cost=False,
        lang="en",
        template="{{firm_name}}|{{currency_name}}|{{balance}}",
        partner_id=15,
        firm_name="Main",
        currency_name="UZS",
        balance=50,
    )
    assert text == "{{firm_name}}|{{currency_name}}|50"


def test_payment_template_placeholders():
    text = format_payment_notification_template(
        {
            "code": "P-1",
            "date": 1_700_000_000,
            "amount": 50,
            "type": {"name": "Cash"},
            "category": {"name": "Sales", "positive": False},
            "currency": {"name": "UZS"},
            "partner": {"id": 15, "name": "Acme"},
            "firm": {"id": 4, "name": "Main"},
        },
        is_cancelled=False,
        lang="en",
        template="{{document_code}} {{amount}} {{balance}}",
        partner_id=15,
        partner_name="Acme",
        firm_name="Main",
        currency_name="UZS",
        balance=80,
    )
    assert text == "P-1 50 80"


def test_blank_document_template_uses_builtin():
    text = format_document_notification(
        {
            "code": "WS-9",
            "date": 1_700_000_000,
            "currency": {"id": 1, "name": "UZS"},
            "partner": {"id": 15, "name": "Acme"},
        },
        [{"item": {"name": "Rice"}, "quantity": 2, "price": 10}],
        "Main",
        is_cancelled=False,
        is_return=False,
        use_cost=False,
        lang="en",
        template="   ",
        partner_id=15,
    )
    assert "Purchase receipt" in text or "receipt" in text.lower() or "WS-9" in text


def test_document_items_loop_placeholders():
    text = format_document_notification(
        {
            "code": "WS-9",
            "date": 1_700_000_000,
            "currency": {"id": 1, "name": "UZS"},
            "partner": {"id": 15, "name": "Acme"},
        },
        [
            {
                "item": {
                    "name": "Rice",
                    "code": "RICE-1",
                    "articul": "SKU-R",
                    "barcode": "460111",
                },
                "quantity": 2,
                "price": 10,
                "description": "Grade A",
            },
            {
                "item": {
                    "name": "Oil",
                    "code": "OIL-2",
                    "articul": "SKU-O",
                    "base_barcode": "460222",
                },
                "quantity": 1,
                "price": 5,
            },
        ],
        "Main",
        is_cancelled=False,
        is_return=False,
        use_cost=False,
        lang="en",
        template=(
            "<b>{{partner_name}}</b>\n"
            "{{#items}}"
            "{{index}}. <b>{{name}}</b> "
            "<code>{{barcode}}</code> / {{articul}} / {{code}} "
            "{{quantity}} × {{price}} = {{line_total}}"
            "{{description}}\n"
            "{{/items}}"
            "Total {{total}}"
        ),
        partner_id=15,
        partner_name="Acme",
    )
    assert text.startswith("<b>Acme</b>\n")
    assert "1. <b>Rice</b> <code>460111</code> / SKU-R / RICE-1 2 × 10 = 20Grade A" in text
    assert "2. <b>Oil</b> <code>460222</code> / SKU-O / OIL-2 1 × 5 = 5" in text
    assert text.endswith("Total 25")


def test_document_items_loop_escapes_values_keeps_html_tags():
    text = format_document_notification(
        {
            "code": "A<B>&C",
            "date": 1_700_000_000,
            "currency": {"id": 1, "name": "UZS"},
            "partner": {"id": 15, "name": "Acme & Co"},
        },
        [
            {
                "item": {"name": "Rice <Premium>", "barcode": "12&34"},
                "quantity": 1,
                "price": 10,
            }
        ],
        "Main",
        is_cancelled=False,
        is_return=False,
        use_cost=False,
        lang="en",
        template="<b>{{partner_name}}</b> {{document_code}}\n{{#items}}{{name}} {{barcode}}\n{{/items}}",
        partner_id=15,
        partner_name="Acme & Co",
    )
    assert "<b>Acme &amp; Co</b> A&lt;B&gt;&amp;C" in text
    assert "Rice &lt;Premium&gt; 12&amp;34" in text


def test_document_items_loop_empty_operations():
    text = format_document_notification(
        {
            "code": "WS-9",
            "date": 1_700_000_000,
            "currency": {"id": 1, "name": "UZS"},
            "partner": {"id": 15, "name": "Acme"},
        },
        [],
        "Main",
        is_cancelled=False,
        is_return=False,
        use_cost=False,
        lang="en",
        template="Before{{#items}}{{name}}{{/items}}After {{total}}",
        partner_id=15,
        partner_name="Acme",
    )
    assert text == "BeforeAfter 0"


def test_legacy_items_placeholder_still_works():
    text = format_document_notification(
        {
            "code": "WS-9",
            "date": 1_700_000_000,
            "currency": {"id": 1, "name": "UZS"},
            "partner": {"id": 15, "name": "Acme"},
        },
        [{"item": {"name": "Rice"}, "quantity": 2, "price": 10}],
        "Main",
        is_cancelled=False,
        is_return=False,
        use_cost=False,
        lang="en",
        template="{{items}}\nTotal {{total}}",
        partner_id=15,
    )
    assert "1. Rice" in text
    assert "2 × 10 = 20" in text
    assert "Total 20" in text


def test_expand_conditionals_if_else_and_unmatched():
    assert (
        expand_conditionals(
            "{{#if cancelled}}X{{else}}Y{{/if}}",
            {"cancelled": "CANCELLED"},
        )
        == "X"
    )
    assert (
        expand_conditionals(
            "{{#if cancelled}}X{{else}}Y{{/if}}",
            {"cancelled": ""},
        )
        == "Y"
    )
    assert expand_conditionals("{{#if cancelled}}X", {"cancelled": "yes"}) == "{{#if cancelled}}X"


def test_document_if_cancelled_then_else():
    base_doc = {
        "code": "WS-9",
        "date": 1_700_000_000,
        "currency": {"id": 1, "name": "UZS"},
        "partner": {"id": 15, "name": "Acme"},
    }
    ops = [{"item": {"name": "Rice"}, "quantity": 1, "price": 10}]
    template = (
        "{{#if cancelled}}❌ <b>{{cancelled}}</b>\n{{else}}OK\n{{/if}}"
        "{{partner_name}}"
    )
    cancelled_text = format_document_notification(
        base_doc,
        ops,
        "Main",
        is_cancelled=True,
        is_return=False,
        use_cost=False,
        lang="en",
        template=template,
        partner_id=15,
        partner_name="Acme",
    )
    assert cancelled_text.startswith("❌ <b>CANCELLED</b>\n")
    assert "OK" not in cancelled_text
    assert "Acme" in cancelled_text

    normal_text = format_document_notification(
        base_doc,
        ops,
        "Main",
        is_cancelled=False,
        is_return=False,
        use_cost=False,
        lang="en",
        template=template,
        partner_id=15,
        partner_name="Acme",
    )
    assert normal_text.startswith("OK\n")
    assert "❌" not in normal_text


def test_document_if_balance_hides_zero():
    doc = {
        "code": "WS-9",
        "date": 1_700_000_000,
        "currency": {"id": 1, "name": "UZS"},
        "partner": {"id": 15, "name": "Acme"},
    }
    ops = [{"item": {"name": "Rice"}, "quantity": 1, "price": 10}]
    template = "Head{{#if balance}}\nDebt {{balance}}{{/if}}"
    zero = format_document_notification(
        doc,
        ops,
        "Main",
        is_cancelled=False,
        is_return=False,
        use_cost=False,
        lang="en",
        template=template,
        partner_id=15,
        balance=0,
    )
    assert zero == "Head"
    positive = format_document_notification(
        doc,
        ops,
        "Main",
        is_cancelled=False,
        is_return=False,
        use_cost=False,
        lang="en",
        template=template,
        partner_id=15,
        balance=150,
    )
    assert positive == "Head\nDebt 150"


def test_document_if_inside_items_loop_on_description():
    text = format_document_notification(
        {
            "code": "WS-9",
            "date": 1_700_000_000,
            "currency": {"id": 1, "name": "UZS"},
            "partner": {"id": 15, "name": "Acme"},
        },
        [
            {"item": {"name": "Rice"}, "quantity": 1, "price": 10, "description": "Grade A"},
            {"item": {"name": "Oil"}, "quantity": 1, "price": 5},
        ],
        "Main",
        is_cancelled=False,
        is_return=False,
        use_cost=False,
        lang="en",
        template=(
            "{{#items}}{{name}}"
            "{{#if description}} ({{description}}){{/if}}\n"
            "{{/items}}"
        ),
        partner_id=15,
    )
    assert "Rice (Grade A)\n" in text
    assert "Oil\n" in text
    assert "Oil (" not in text


def test_document_nested_if():
    text = format_document_notification(
        {
            "code": "WS-9",
            "date": 1_700_000_000,
            "currency": {"id": 1, "name": "UZS"},
            "partner": {"id": 15, "name": "Acme"},
        },
        [{"item": {"name": "Rice"}, "quantity": 1, "price": 10}],
        "Main",
        is_cancelled=True,
        is_return=False,
        use_cost=False,
        lang="en",
        template=(
            "{{#if cancelled}}"
            "{{#if balance}}C+B{{else}}C-only{{/if}}"
            "{{else}}normal{{/if}}"
        ),
        partner_id=15,
        balance=0,
    )
    assert text == "C-only"


def test_document_if_escapes_values_in_kept_branch():
    text = format_document_notification(
        {
            "code": "A<B>",
            "date": 1_700_000_000,
            "currency": {"id": 1, "name": "UZS"},
            "partner": {"id": 15, "name": "Acme"},
        },
        [{"item": {"name": "Rice"}, "quantity": 1, "price": 10}],
        "Main",
        is_cancelled=True,
        is_return=False,
        use_cost=False,
        lang="en",
        template="{{#if cancelled}}<b>{{document_code}}</b>{{/if}}",
        partner_id=15,
    )
    assert text == "<b>A&lt;B&gt;</b>"


def test_payment_if_cancelled():
    doc = {
        "code": "P-1",
        "date": 1_700_000_000,
        "amount": 50,
        "type": {"name": "Cash"},
        "category": {"name": "Sales", "positive": False},
        "currency": {"name": "UZS"},
        "partner": {"id": 15, "name": "Acme"},
    }
    template = "{{#if cancelled}}X {{cancelled}}{{else}}{{document_code}}{{/if}}"
    cancelled = format_payment_notification_template(
        doc, is_cancelled=True, lang="en", template=template, partner_id=15
    )
    assert cancelled == "X CANCELLED"
    normal = format_payment_notification_template(
        doc, is_cancelled=False, lang="en", template=template, partner_id=15
    )
    assert normal == "P-1"


def test_balance_line_if_balance():
    text = format_balance_line_notification(
        15,
        firm_name="Main",
        currency_name="UZS",
        balance=0,
        lang="en",
        template="{{#if balance}}{{firm_name}} {{balance}}{{else}}none{{/if}}",
        partner_name="Acme",
    )
    assert text == "none"
    text = format_balance_line_notification(
        15,
        firm_name="Main",
        currency_name="UZS",
        balance=12.5,
        lang="en",
        template="{{#if balance}}{{firm_name}} {{balance}}{{else}}none{{/if}}",
        partner_name="Acme",
    )
    assert text == "Main 12.5"
