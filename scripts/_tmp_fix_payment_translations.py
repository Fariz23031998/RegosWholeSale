import json
from pathlib import Path

ROOT = Path("backend/app/translations")

EXTRA = {
    "en": {
        "nav.payments": "Payments",
        "meta.paymentsTitle": "Payments · Regos Optom",
        "meta.paymentsDescription": "Create and manage income and outcome payment documents.",
        "payments.title": "Payments",
        "payments.loading": "Loading payments…",
        "payments.empty": "No payments match these filters.",
        "payments.searchPlaceholder": "Search by code or partner…",
        "payments.searchAria": "Search payments",
        "payments.subtitle": "{{count}} payments · {{total}} · {{period}} · {{partners}}",
        "payments.showing": "Showing {{shown}} of {{total}}",
        "payments.income": "Income",
        "payments.outcome": "Outcome",
        "payments.direction": "Direction",
        "payments.partner": "Partner",
        "payments.firm": "Enterprise",
        "payments.paymentType": "Payment type",
        "payments.category": "Category",
        "payments.amount": "Amount",
        "payments.exchangeRate": "Exchange rate",
        "payments.description": "Description",
        "payments.status": "Status",
        "payments.status.performed": "Performed",
        "payments.status.draft": "Not performed",
        "payments.status.deletedMark": "Marked for deletion",
        "payments.table.code": "Code",
        "payments.table.date": "Date",
        "payments.errors.load": "Failed to load payments.",
        "payments.create.button": "New payment",
        "payments.create.title": "New payment",
        "payments.create.selectPartner": "Select partner",
        "payments.create.selectFirm": "Select enterprise",
        "payments.create.selectPaymentType": "Select payment type",
        "payments.create.invalidAmount": "Enter a valid amount.",
        "payments.create.submit": "Create payment",
        "payments.create.processing": "Creating…",
        "payments.create.success": "Payment created.",
        "payments.create.error": "Failed to create payment.",
        "payments.detail.title": "Payment {{code}}",
        "payments.detail.editSuccess": "Payment updated.",
        "payments.detail.editError": "Failed to update payment.",
        "payments.actions.edit": "Edit",
        "payments.actions.perform": "Perform",
        "payments.actions.performCancel": "Cancel perform",
        "payments.actions.deleteMark": "Mark for deletion",
        "payments.actions.unmark": "Remove delete mark",
        "payments.actions.delete": "Delete permanently",
        "payments.actions.performSuccess": "Payment performed.",
        "payments.actions.performCancelSuccess": "Payment perform canceled.",
        "payments.actions.deleteMarkSuccess": "Delete mark toggled.",
        "payments.actions.deleteSuccess": "Payment deleted.",
    },
    "ru": {
        "nav.payments": "Платежи",
        "meta.paymentsTitle": "Платежи · Regos Optom",
        "meta.paymentsDescription": "Создание и управление документами входящих и исходящих платежей.",
        "payments.title": "Платежи",
        "payments.loading": "Загрузка платежей…",
        "payments.empty": "Нет платежей по выбранным фильтрам.",
        "payments.searchPlaceholder": "Поиск по коду или контрагенту…",
        "payments.searchAria": "Поиск платежей",
        "payments.subtitle": "{{count}} платежей · {{total}} · {{period}} · {{partners}}",
        "payments.showing": "Показано {{shown}} из {{total}}",
        "payments.income": "Приход",
        "payments.outcome": "Расход",
        "payments.direction": "Направление",
        "payments.partner": "Контрагент",
        "payments.firm": "Предприятие",
        "payments.paymentType": "Тип оплаты",
        "payments.category": "Статья",
        "payments.amount": "Сумма",
        "payments.exchangeRate": "Курс",
        "payments.description": "Описание",
        "payments.status": "Статус",
        "payments.status.performed": "Проведён",
        "payments.status.draft": "Не проведён",
        "payments.status.deletedMark": "Помечен на удаление",
        "payments.table.code": "Код",
        "payments.table.date": "Дата",
        "payments.errors.load": "Не удалось загрузить платежи.",
        "payments.create.button": "Новый платёж",
        "payments.create.title": "Новый платёж",
        "payments.create.selectPartner": "Выберите контрагента",
        "payments.create.selectFirm": "Выберите предприятие",
        "payments.create.selectPaymentType": "Выберите тип оплаты",
        "payments.create.invalidAmount": "Введите корректную сумму.",
        "payments.create.submit": "Создать платёж",
        "payments.create.processing": "Создание…",
        "payments.create.success": "Платёж создан.",
        "payments.create.error": "Не удалось создать платёж.",
        "payments.detail.title": "Платёж {{code}}",
        "payments.detail.editSuccess": "Платёж обновлён.",
        "payments.detail.editError": "Не удалось обновить платёж.",
        "payments.actions.edit": "Изменить",
        "payments.actions.perform": "Провести",
        "payments.actions.performCancel": "Отменить проведение",
        "payments.actions.deleteMark": "Пометить на удаление",
        "payments.actions.unmark": "Снять пометку удаления",
        "payments.actions.delete": "Удалить навсегда",
        "payments.actions.performSuccess": "Платёж проведён.",
        "payments.actions.performCancelSuccess": "Проведение платежа отменено.",
        "payments.actions.deleteMarkSuccess": "Пометка удаления изменена.",
        "payments.actions.deleteSuccess": "Платёж удалён.",
    },
}

EXTRA["uz"] = {
    **EXTRA["en"],
    "nav.payments": "To'lovlar",
    "meta.paymentsTitle": "To'lovlar · Regos Optom",
    "meta.paymentsDescription": "Kirim va chiqim to'lov hujjatlarini yaratish va boshqarish.",
    "payments.title": "To'lovlar",
    "payments.income": "Kirim",
    "payments.outcome": "Chiqim",
    "payments.create.button": "Yangi to'lov",
    "payments.create.title": "Yangi to'lov",
}
EXTRA["tj"] = {
    **EXTRA["en"],
    "nav.payments": "Пардохтҳо",
    "meta.paymentsTitle": "Пардохтҳо · Regos Optom",
    "meta.paymentsDescription": "Эҷод ва идоракунии ҳуҷҷатҳои пардохти воридот ва хароҷот.",
    "payments.title": "Пардохтҳо",
    "payments.income": "Воридот",
    "payments.outcome": "Хароҷот",
    "payments.create.button": "Пардохти нав",
    "payments.create.title": "Пардохти нав",
}

for lang, extras in EXTRA.items():
    path = ROOT / f"{lang}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    translations = data.get("translations")
    if not isinstance(translations, dict):
        raise SystemExit(f"Missing translations object in {path}")

    # Remove mistakenly added root-level keys from earlier script.
    for key in list(data.keys()):
        if key in {"version", "last_updated", "translations"}:
            continue
        if key.startswith("meta.payments") or key.startswith("payments.") or key == "nav.payments":
            data.pop(key, None)

    translations.update(extras)
    data["translations"] = translations
    path.write_text(json.dumps(data, ensure_ascii=False, indent=4) + "\n", encoding="utf-8")
    print(f"fixed {path}")
