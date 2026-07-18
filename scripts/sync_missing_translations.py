"""Add missing translation keys to en.json and locale files, then regenerate.

Workflow:
1. Insert new English keys into backend/app/translations/en.json
2. Merge new + gap translations into ru/uz/tj backend files
3. Sync scripts/locales/{lang}.json from backend locale files
4. Run generate_translations.py (rebuilds locales + fallback-translations.ts)
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TRANSLATIONS_DIR = ROOT / "backend" / "app" / "translations"
LOCALES_DIR = Path(__file__).resolve().parent / "locales"
VERSION = "1.1.0"

# Keys used in the UI / fallback but missing from en.json
NEW_EN: dict[str, str] = {
    "cache.clearAll": "Clear All Cache",
    "cache.clearAllSuccess": "All cached data cleared.",
    "cache.clearCatalog": "Clear Product Catalog",
    "cache.clearCatalogSuccess": "Product catalog cache cleared.",
    "cache.clearError": "Failed to clear cache.",
    "cache.clearPartners": "Clear Partners",
    "cache.clearPartnersSuccess": "Partners cache cleared.",
    "cache.clearPayments": "Clear Payment Types",
    "cache.clearPaymentsSuccess": "Payment types cache cleared.",
    "cache.clearSettings": "Clear Settings",
    "cache.clearSettingsSuccess": "Settings cache cleared.",
    "cache.enableCaching": "Enable caching",
    "cache.selectorLabel": "Cache Management",
    "cache.toggleError": "Failed to update cache setting.",
    "cart.continueModal.emptyOrders": "No postponed orders found.",
    "cart.postponedOrderBanner": "Continuing postponed order #{{id}}",
    "checkout.crossCurrencySettlementNote": (
        "Payment will be recorded in {{saleCurrency}} and transferred to the selected payment account."
    ),
    "checkout.saleCurrency": "sale currency",
    "common.refresh": "Refresh",
    "common.unknown": "Unknown",
    "notifications.dismiss": "Dismiss",
    "notifications.empty": "No failed sales to sync.",
    "notifications.failedSaleTitle": "Failed sale",
    "notifications.kindCheckout": "Checkout",
    "notifications.kindPostpone": "Postpone",
    "notifications.menuLabel": "Sync notifications",
    "notifications.moreItems": "+{{count}} more",
    "notifications.open": "Open",
    "notifications.paymentAmount": "Payment amount",
    "notifications.restoreRetry": "Restore & retry",
    "notifications.retrySync": "Retry sync",
    "notifications.statusFailed": "Failed",
    "notifications.statusPending": "Waiting to sync",
    "notifications.statusSyncing": "Syncing…",
    "notifications.syncFailed": "Sale sync failed",
    "notifications.title": "Sync failures",
    "partners.groupFilterAll": "All groups",
    "partners.groupFilterAria": "Filter by group",
    "partners.refreshTitle": "Force Refresh",
    "pos.catalog.downloadFailure": "Failed to download catalog.",
    "pos.catalog.downloadSuccess": "Catalog downloaded successfully!",
    "pos.catalog.downloading": "Downloading complete product catalog...",
    "pos.catalogFilter.saveFailed": "Failed to update catalog filters.",
    "pos.includeZeroPriceShort": "Zero price",
    "pos.includeZeroQuantityShort": "Zero qty",
    "pos.sellContext.ariaLabelMobile": "Warehouse and price type",
    "pos.sellContext.partnerSelected": "Partner: {{name}}",
    "settings.telegram.webhook": "Webhook",
}

# Preferred insert anchors so related keys stay grouped (key -> insert after this key)
INSERT_AFTER: dict[str, str] = {
    "common.refresh": "common.retry",
    "common.unknown": "common.refresh",
    "pos.includeZeroQuantityShort": "pos.hideImagesAria",
    "pos.includeZeroPriceShort": "pos.includeZeroQuantityShort",
    "pos.catalogFilter.saveFailed": "pos.includeZeroPriceShort",
    "pos.catalog.downloading": "pos.preparing",
    "pos.catalog.downloadSuccess": "pos.catalog.downloading",
    "pos.catalog.downloadFailure": "pos.catalog.downloadSuccess",
    "pos.sellContext.ariaLabelMobile": "pos.sellContext.ariaLabel",
    "pos.sellContext.partnerSelected": "pos.sellContext.partner",
    "cart.postponedOrderBanner": "cart.postponedBanner",
    "cart.continueModal.emptyOrders": "cart.continueModal.loading",
    "checkout.saleCurrency": "checkout.convertedAmount",
    "checkout.crossCurrencySettlementNote": "checkout.saleCurrency",
    "partners.groupFilterAll": "partners.searchAria",
    "partners.groupFilterAria": "partners.groupFilterAll",
    "partners.refreshTitle": "partners.groupFilterAria",
    "settings.telegram.webhook": "settings.telegram.botToken",
    "cache.selectorLabel": "theme.selectorLabel",
    "cache.enableCaching": "cache.selectorLabel",
    "cache.clearCatalog": "cache.enableCaching",
    "cache.clearPartners": "cache.clearCatalog",
    "cache.clearPayments": "cache.clearPartners",
    "cache.clearSettings": "cache.clearPayments",
    "cache.clearAll": "cache.clearSettings",
    "cache.clearCatalogSuccess": "cache.clearAll",
    "cache.clearPartnersSuccess": "cache.clearCatalogSuccess",
    "cache.clearPaymentsSuccess": "cache.clearPartnersSuccess",
    "cache.clearSettingsSuccess": "cache.clearPaymentsSuccess",
    "cache.clearAllSuccess": "cache.clearSettingsSuccess",
    "cache.clearError": "cache.clearAllSuccess",
    "cache.toggleError": "cache.clearError",
    "notifications.menuLabel": "errors.generic",
    "notifications.title": "notifications.menuLabel",
    "notifications.empty": "notifications.title",
    "notifications.kindCheckout": "notifications.empty",
    "notifications.kindPostpone": "notifications.kindCheckout",
    "notifications.open": "notifications.kindPostpone",
    "notifications.retrySync": "notifications.open",
    "notifications.dismiss": "notifications.retrySync",
    "notifications.failedSaleTitle": "notifications.dismiss",
    "notifications.moreItems": "notifications.failedSaleTitle",
    "notifications.paymentAmount": "notifications.moreItems",
    "notifications.restoreRetry": "notifications.paymentAmount",
    "notifications.syncFailed": "notifications.restoreRetry",
    "notifications.statusPending": "notifications.syncFailed",
    "notifications.statusSyncing": "notifications.statusPending",
    "notifications.statusFailed": "notifications.statusSyncing",
}

NEW_RU: dict[str, str] = {
    "cache.clearAll": "Очистить весь кэш",
    "cache.clearAllSuccess": "Весь кэш очищен.",
    "cache.clearCatalog": "Очистить каталог товаров",
    "cache.clearCatalogSuccess": "Кэш каталога товаров очищен.",
    "cache.clearError": "Не удалось очистить кэш.",
    "cache.clearPartners": "Очистить контрагентов",
    "cache.clearPartnersSuccess": "Кэш контрагентов очищен.",
    "cache.clearPayments": "Очистить типы оплаты",
    "cache.clearPaymentsSuccess": "Кэш типов оплаты очищен.",
    "cache.clearSettings": "Очистить настройки",
    "cache.clearSettingsSuccess": "Кэш настроек очищен.",
    "cache.enableCaching": "Включить кэширование",
    "cache.selectorLabel": "Управление кэшем",
    "cache.toggleError": "Не удалось обновить настройку кэша.",
    "cart.continueModal.emptyOrders": "Отложенных заказов не найдено.",
    "cart.postponedOrderBanner": "Продолжение отложенного заказа №{{id}}",
    "checkout.crossCurrencySettlementNote": (
        "Платёж будет зафиксирован в {{saleCurrency}} и переведён на выбранный счёт оплаты."
    ),
    "checkout.saleCurrency": "валюте продажи",
    "common.refresh": "Обновить",
    "common.unknown": "Неизвестно",
    "notifications.dismiss": "Закрыть",
    "notifications.empty": "Нет неудачных продаж для синхронизации.",
    "notifications.failedSaleTitle": "Неудачная продажа",
    "notifications.kindCheckout": "Оплата",
    "notifications.kindPostpone": "Отложить",
    "notifications.menuLabel": "Уведомления синхронизации",
    "notifications.moreItems": "+ ещё {{count}}",
    "notifications.open": "Открыть",
    "notifications.paymentAmount": "Сумма оплаты",
    "notifications.restoreRetry": "Восстановить и повторить",
    "notifications.retrySync": "Повторить синхронизацию",
    "notifications.statusFailed": "Ошибка",
    "notifications.statusPending": "Ожидает синхронизации",
    "notifications.statusSyncing": "Синхронизация…",
    "notifications.syncFailed": "Синхронизация продажи не удалась",
    "notifications.title": "Ошибки синхронизации",
    "partners.groupFilterAll": "Все группы",
    "partners.groupFilterAria": "Фильтр по группе",
    "partners.refreshTitle": "Принудительное обновление",
    "pos.catalog.downloadFailure": "Не удалось скачать каталог.",
    "pos.catalog.downloadSuccess": "Каталог успешно скачан!",
    "pos.catalog.downloading": "Скачивание полного каталога товаров...",
    "pos.catalogFilter.saveFailed": "Не удалось обновить фильтры каталога.",
    "pos.includeZeroPriceShort": "Нулевая цена",
    "pos.includeZeroQuantityShort": "Нулевой остаток",
    "pos.sellContext.ariaLabelMobile": "Склад и тип цены",
    "pos.sellContext.partnerSelected": "Контрагент: {{name}}",
    "settings.telegram.webhook": "Вебхук",
    "settings.regos.tokenRequired": "Требуется токен интеграции.",
}

NEW_UZ: dict[str, str] = {
    "cache.clearAll": "Barcha keshni tozalash",
    "cache.clearAllSuccess": "Barcha kesh tozalandi.",
    "cache.clearCatalog": "Mahsulot katalogini tozalash",
    "cache.clearCatalogSuccess": "Mahsulot katalogi keshi tozalandi.",
    "cache.clearError": "Keshni tozalab bo'lmadi.",
    "cache.clearPartners": "Hamkorlarni tozalash",
    "cache.clearPartnersSuccess": "Hamkorlar keshi tozalandi.",
    "cache.clearPayments": "To'lov turlarini tozalash",
    "cache.clearPaymentsSuccess": "To'lov turlari keshi tozalandi.",
    "cache.clearSettings": "Sozlamalarni tozalash",
    "cache.clearSettingsSuccess": "Sozlamalar keshi tozalandi.",
    "cache.enableCaching": "Keshni yoqish",
    "cache.selectorLabel": "Kesh boshqaruvi",
    "cache.toggleError": "Kesh sozlamasini yangilab bo'lmadi.",
    "cart.continueModal.emptyOrders": "Kechiktirilgan buyurtmalar topilmadi.",
    "cart.postponedOrderBanner": "Kechiktirilgan buyurtmani davom ettirish #{{id}}",
    "checkout.crossCurrencySettlementNote": (
        "To'lov {{saleCurrency}} da qayd etiladi va tanlangan to'lov hisobiga o'tkaziladi."
    ),
    "checkout.saleCurrency": "sotuv valyutasi",
    "common.refresh": "Yangilash",
    "common.unknown": "Noma'lum",
    "notifications.dismiss": "Yopish",
    "notifications.empty": "Sinxronlash uchun muvaffaqiyatsiz sotuvlar yo'q.",
    "notifications.failedSaleTitle": "Muvaffaqiyatsiz sotuv",
    "notifications.kindCheckout": "To'lov",
    "notifications.kindPostpone": "Kechiktirish",
    "notifications.menuLabel": "Sinxronlash bildirishnomalari",
    "notifications.moreItems": "+ yana {{count}}",
    "notifications.open": "Ochish",
    "notifications.paymentAmount": "To'lov summasi",
    "notifications.restoreRetry": "Tiklash va qayta urinish",
    "notifications.retrySync": "Sinxronlashni qayta urinish",
    "notifications.statusFailed": "Xato",
    "notifications.statusPending": "Sinxronlash kutilmoqda",
    "notifications.statusSyncing": "Sinxronlanmoqda…",
    "notifications.syncFailed": "Sotuv sinxronlanmadi",
    "notifications.title": "Sinxronlash xatolari",
    "partners.groupFilterAll": "Barcha guruhlar",
    "partners.groupFilterAria": "Guruh bo'yicha filtr",
    "partners.refreshTitle": "Majburiy yangilash",
    "pos.catalog.downloadFailure": "Katalogni yuklab bo'lmadi.",
    "pos.catalog.downloadSuccess": "Katalog muvaffaqiyatli yuklandi!",
    "pos.catalog.downloading": "To'liq mahsulot katalogi yuklanmoqda...",
    "pos.catalogFilter.saveFailed": "Katalog filtrlarini yangilab bo'lmadi.",
    "pos.includeZeroPriceShort": "Nol narx",
    "pos.includeZeroQuantityShort": "Nol qoldiq",
    "pos.sellContext.ariaLabelMobile": "Ombor va narx turi",
    "pos.sellContext.partnerSelected": "Hamkor: {{name}}",
    "settings.telegram.webhook": "Webhook",
    # Gaps already in en/ru but missing from uz.json
    "cart.postponeSuccess": "Sotuv kechiktirildi",
    "pos.barcode.cameraDenied": "Shtrixkod skanerlash uchun kamera ruxsati kerak",
    "pos.barcode.cameraUnavailable": "Kamerani ishga tushirib bo'lmadi",
    "pos.barcode.insecureContext": (
        "Kamera skanerlash uchun HTTPS kerak. Saytni http:// o'rniga https:// orqali oching"
    ),
    "pos.barcode.invalidQty": "Bu shtrixkod miqdori mahsulot o'lchov birligi uchun yaroqsiz.",
    "pos.barcode.outOfStock": "Bu mahsulotni savatga ko'proq qo'shib bo'lmaydi.",
    "pos.barcode.productNotFound": "Bu shtrixkod bo'yicha mahsulot topilmadi.",
    "pos.barcode.scanSuccess": "{{name}} savatga qo'shildi",
    "pos.barcode.torchOff": "Fonarni o'chirish",
    "pos.barcode.torchOn": "Fonarni yoqish",
    "pos.barcode.torchUnavailable": "Bu qurilmada fonar mavjud emas",
    "pos.scanBarcode": "Shtrixkodni skanerlash",
    "pos.scanBarcodeAria": "Kamera orqali shtrixkodni skanerlash",
    "pos.scanBarcodeHint": "Kamerani mahsulot shtrixkodiga qarating",
    "settings.pos.postponeDocOrderFromPartner": "Hamkor buyurtmasi (DocOrderFromPartner)",
    "settings.pos.postponeDocWholesale": "Ulgurji sotuv (DocWholeSale)",
    "settings.pos.postponeDocumentType": "Kechiktirilgan sotuv hujjati",
    "settings.pos.postponeDocumentTypeDesc": (
        "Kassir sotuvni kechiktirganda yaratiladigan Regos hujjat turini tanlang."
    ),
    "settings.pos.postponeOrderBooked": "Band qilingan",
    "settings.pos.postponeOrderBookedDesc": (
        "Kechiktirilgan hamkor buyurtmalarini Regosda band qilingan deb belgilash."
    ),
    "settings.regos.tokenRequired": "Integratsiya tokeni talab qilinadi.",
}

NEW_TJ: dict[str, str] = {
    "cache.clearAll": "Тоза кардани ҳамаи кэш",
    "cache.clearAllSuccess": "Ҳамаи кэш тоза шуд.",
    "cache.clearCatalog": "Тоза кардани каталоги маҳсулот",
    "cache.clearCatalogSuccess": "Кэши каталоги маҳсулот тоза шуд.",
    "cache.clearError": "Кэш тоза карда нашуд.",
    "cache.clearPartners": "Тоза кардани шарикон",
    "cache.clearPartnersSuccess": "Кэши шарикон тоза шуд.",
    "cache.clearPayments": "Тоза кардани намудҳои пардохт",
    "cache.clearPaymentsSuccess": "Кэши намудҳои пардохт тоза шуд.",
    "cache.clearSettings": "Тоза кардани танзимот",
    "cache.clearSettingsSuccess": "Кэши танзимот тоза шуд.",
    "cache.enableCaching": "Фаъол кардани кэш",
    "cache.selectorLabel": "Идоракунии кэш",
    "cache.toggleError": "Танзими кэш навсозӣ нашуд.",
    "cart.continueModal.emptyOrders": "Фармоишҳои қайдшуда ёфт нашуданд.",
    "cart.postponedOrderBanner": "Давоми фармоиши қайдшуда #{{id}}",
    "checkout.crossCurrencySettlementNote": (
        "Пардохт дар {{saleCurrency}} сабт шуда ба ҳисоби интихобшудаи пардохт гузаронда мешавад."
    ),
    "checkout.saleCurrency": "асъори фурӯш",
    "common.refresh": "Навсозӣ",
    "common.unknown": "Номаълум",
    "notifications.dismiss": "Пӯшидан",
    "notifications.empty": "Фурӯшҳои ноком барои ҳамоҳангсозӣ нестанд.",
    "notifications.failedSaleTitle": "Фурӯши ноком",
    "notifications.kindCheckout": "Пардохт",
    "notifications.kindPostpone": "Қайд",
    "notifications.menuLabel": "Огоҳиҳои ҳамоҳангсозӣ",
    "notifications.moreItems": "+ боз {{count}}",
    "notifications.open": "Кушодан",
    "notifications.paymentAmount": "Маблағи пардохт",
    "notifications.restoreRetry": "Барқарор ва такрор",
    "notifications.retrySync": "Такрори ҳамоҳангсозӣ",
    "notifications.statusFailed": "Хато",
    "notifications.statusPending": "Интизори ҳамоҳангсозӣ",
    "notifications.statusSyncing": "Ҳамоҳангсозӣ…",
    "notifications.syncFailed": "Ҳамоҳангсозии фурӯш ноком шуд",
    "notifications.title": "Хатоҳои ҳамоҳангсозӣ",
    "partners.groupFilterAll": "Ҳамаи гурӯҳҳо",
    "partners.groupFilterAria": "Филтр аз рӯи гурӯҳ",
    "partners.refreshTitle": "Навсозии маҷбурӣ",
    "pos.catalog.downloadFailure": "Каталог боргирӣ нашуд.",
    "pos.catalog.downloadSuccess": "Каталог бомуваффақият боргирӣ шуд!",
    "pos.catalog.downloading": "Боргирии каталоги пурраи маҳсулот...",
    "pos.catalogFilter.saveFailed": "Филтрҳои каталог навсозӣ нашуданд.",
    "pos.includeZeroPriceShort": "Нархи сифр",
    "pos.includeZeroQuantityShort": "Боқимондаи сифр",
    "pos.sellContext.ariaLabelMobile": "Анбор ва намуди нарх",
    "pos.sellContext.partnerSelected": "Шарик: {{name}}",
    "settings.telegram.webhook": "Webhook",
    "settings.regos.tokenRequired": "Токени интегратсия лозим аст.",
    # Gaps already in en but missing from tj.json
    "users.form.loginHint": "Номи корбар барои ворид шудан ба барнома.",
    "users.form.loginOwnerHint": (
        "Номи корбари ихтиёрӣ барои воридшавӣ. Шумо ҳамчунон метавонед почтаи электрониро истифода баред."
    ),
    "users.form.permissionsHint": (
        "Барои ҳар иҷозат Қоидаҳои Иҷозат ё Манъро гузоред. Мерос аз нақши корманд истифода мешавад."
    ),
    "users.form.permissionsTitle": "Иҷозатҳо",
    "users.form.validationLogin": "Логин ҳатмӣ аст ва бояд ҳадди ақал 2 аломат дошта бошад.",
    "users.form.validationLoginFormat": (
        "Логин наметавонад @ дошта бошад. Барои суроғаҳои почта воридшавии почтаро истифода баред."
    ),
    "users.permissions.codes.dashboard.read": "Дидани панел",
    "users.permissions.codes.documents.print": "Чопи ҳуҷҷатҳо",
    "users.permissions.codes.pos.access": "Дастрасӣ ба POS",
    "users.permissions.codes.pos.apply_discount": "Татбиқи тахфиф",
    "users.permissions.codes.pos.change_partner": "Иваз кардани шарик",
    "users.permissions.codes.pos.change_price_type": "Иваз кардани намуди нарх",
    "users.permissions.codes.pos.change_warehouse": "Иваз кардани анбор",
    "users.permissions.codes.pos.modify_price": "Тағйири нарх",
    "users.permissions.codes.returns.manage": "Коркарди бозгаштҳо",
    "users.permissions.codes.sales.continue": "Давом додани фурӯш",
    "users.permissions.codes.sales.postpone": "Қайди фурӯш",
    "users.permissions.codes.sales.read": "Дидани фурӯшҳо",
    "users.permissions.codes.sales.write": "Эҷоди фурӯшҳо",
    "users.permissions.codes.settings.manage": "Идоракунии танзимот",
    "users.permissions.codes.users.manage": "Идоракунии корбарон",
    "users.permissions.column.permission": "Иҷозат",
    "users.permissions.descriptions.dashboard.read": "Дидани таҳлили панел",
    "users.permissions.descriptions.documents.print": "Чопи чекҳо, ҳисобномаҳо ва ҳуҷҷатҳо",
    "users.permissions.descriptions.pos.access": "Дастрасӣ ба терминали POS",
    "users.permissions.descriptions.pos.apply_discount": "Татбиқи тахфифҳо дар фурӯшҳо",
    "users.permissions.descriptions.pos.change_partner": (
        "Иваз кардани мизоҷ ё шарики интихобшуда дар экрани фурӯш"
    ),
    "users.permissions.descriptions.pos.change_price_type": (
        "Иваз кардани намуди нархи интихобшуда дар экрани фурӯш"
    ),
    "users.permissions.descriptions.pos.change_warehouse": (
        "Иваз кардани анбори интихобшуда дар экрани фурӯш"
    ),
    "users.permissions.descriptions.pos.modify_price": "Тағйири нархи маҳсулот дар фурӯшҳо",
    "users.permissions.descriptions.returns.manage": "Коркарди бозгаштҳо",
    "users.permissions.descriptions.sales.continue": "Давом додани фурӯшҳои қайдшуда",
    "users.permissions.descriptions.sales.postpone": "Қайди фурӯшҳо",
    "users.permissions.descriptions.sales.read": "Дидани таърихи фурӯшҳо",
    "users.permissions.descriptions.sales.write": "Эҷод ва тағйири фурӯшҳо",
    "users.permissions.descriptions.settings.manage": "Идоракунии танзимоти ширкат ва корбарон",
    "users.permissions.descriptions.users.manage": "Идоракунии корбарон, иҷозатҳо ва ҷадвалҳо",
    "users.permissions.effect.allow": "Иҷозат",
    "users.permissions.effect.deny": "Манъ",
    "users.permissions.effect.inherit": "Мерос",
    "users.permissions.groups.administration": "Маъмурият",
    "users.permissions.groups.documents": "Ҳуҷҷатҳо",
    "users.permissions.groups.pos": "Дастрасӣ ба POS",
    "users.permissions.groups.posContext": "Контексти фурӯш",
    "users.permissions.groups.returns": "Бозгаштҳо",
    "users.permissions.groups.salesActions": "Амалҳои фурӯш",
    "users.permissions.roleDefault": "Бо пешфарз дохил аст",
}

LOCALE_ADDITIONS = {
    "ru": NEW_RU,
    "uz": NEW_UZ,
    "tj": NEW_TJ,
}


def load_payload(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def ordered_insert(translations: dict[str, str], new_items: dict[str, str]) -> dict[str, str]:
    """Insert new keys near related ones; append unknowns at end preserving order."""
    items = list(translations.items())
    key_to_idx = {k: i for i, (k, _) in enumerate(items)}

    pending = [(k, v) for k, v in new_items.items() if k not in translations]
    # Insert in dependency order when possible
    inserted: set[str] = set()
    progress = True
    while pending and progress:
        progress = False
        next_pending: list[tuple[str, str]] = []
        for key, value in pending:
            after = INSERT_AFTER.get(key)
            if after is None or after not in key_to_idx:
                next_pending.append((key, value))
                continue
            idx = key_to_idx[after] + 1
            items.insert(idx, (key, value))
            # rebuild index for keys after insert point
            key_to_idx = {k: i for i, (k, _) in enumerate(items)}
            inserted.add(key)
            progress = True
        pending = [(k, v) for k, v in next_pending if k not in inserted]

    for key, value in pending:
        items.append((key, value))

    return dict(items)


def write_payload(path: Path, translations: dict[str, str]) -> None:
    payload = {
        "version": VERSION,
        "last_updated": date.today().isoformat(),
        "translations": translations,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    en_path = TRANSLATIONS_DIR / "en.json"
    en_payload = load_payload(en_path)
    en = en_payload["translations"]

    to_add = {k: v for k, v in NEW_EN.items() if k not in en}
    if to_add:
        en = ordered_insert(en, to_add)
        write_payload(en_path, en)
        print(f"en.json: added {len(to_add)} keys (now {len(en)})")
    else:
        print(f"en.json: already has all new keys ({len(en)})")

    for lang, additions in LOCALE_ADDITIONS.items():
        path = TRANSLATIONS_DIR / f"{lang}.json"
        payload = load_payload(path)
        translations = payload["translations"]
        # Ensure every en key exists; prefer existing locale value, then additions, then English
        merged: dict[str, str] = {}
        added = 0
        for key, en_val in en.items():
            if key in translations:
                merged[key] = translations[key]
            elif key in additions:
                merged[key] = additions[key]
                added += 1
            else:
                merged[key] = en_val
                added += 1
                print(f"  WARN {lang}: no translation for {key}, using English")
        write_payload(path, merged)
        print(f"{lang}.json: merged ({added} filled, now {len(merged)} keys)")

        # Keep scripts/locales in sync (full override set for generate_translations.py)
        LOCALES_DIR.mkdir(parents=True, exist_ok=True)
        override_path = LOCALES_DIR / f"{lang}.json"
        override_path.write_text(
            json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"  wrote {override_path}")

    print("\nRunning generate_translations.py…")
    result = subprocess.run(
        [sys.executable, str(Path(__file__).parent / "generate_translations.py")],
        check=False,
    )
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
