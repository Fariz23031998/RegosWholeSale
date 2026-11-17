#!/usr/bin/env python3
"""Add frontend t() keys missing from en.json and fill locale gaps, then regenerate.

Run: python scripts/sync_frontend_missing_i18n.py
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
VERSION = "1.1.9"

# Keys used via t() in frontend but missing from en.json
NEW_EN: dict[str, str] = {
    "auth.or": "or",
    "auth.signOut": "Sign out",
    "auth.ssoFailed": "REGOS sign-in failed",
    "common.no": "No",
    "common.yes": "Yes",
    "nav.main": "Main",
    "partnerApp.activePartner": "Partner",
    "partnerApp.inactive": "This Telegram account is deactivated. Contact the company.",
    "partnerTelegram.activate": "Activate",
    "partnerTelegram.activePartner": "active",
    "partnerTelegram.deactivate": "Deactivate",
    "partnerTelegram.deleteAccountConfirm": "Delete this Telegram account? This cannot be undone.",
    "partnerTelegram.removePartner": "Remove partner",
    "partnerTelegram.searchAccounts": "Search by name, phone, username, or partner",
    "partnerTelegram.searchEmpty": "No accounts match this search.",
    "partnerTelegram.setActivePartner": "Set as active partner",
    "products.changePrices": "Change prices",
    "products.changePricesTitle": "Change prices",
    "products.choosePrinter": "Choose a connected label printer.",
    "products.connectedPrinter": "Print service is connected. Labels print on {{name}}.",
    "products.currentPrice": "Current price",
    "products.errors.changePrices": "Failed to update prices",
    "products.errors.invalidPrice": "Enter a price of zero or greater.",
    "products.history": "History",
    "products.history.col.cost": "Cost",
    "products.history.col.date": "Date",
    "products.history.col.document": "Document",
    "products.history.col.price": "Price",
    "products.history.col.qty": "Qty",
    "products.history.col.stock": "Stock",
    "products.history.col.type": "Type",
    "products.history.empty": "No movement history for this product",
    "products.history.errors.load": "Failed to load history",
    "products.history.loadMore": "Load more",
    "products.history.shown": "{{n}} of {{m}}",
    "products.history.titleNamed": "History — {{name}}",
    "products.menu": "Product actions",
    "products.newPrice": "New price for {{name}}",
    "products.noConnectedPrinters": "No connected label printers. Connect Print Service to choose a default.",
    "products.noPriceChanges": "Change at least one price.",
    "products.noPrinterPreference": "No preference",
    "products.priceTypeRequired": "Select a price type",
    "products.printUpdatedPrompt": "Print labels with the updated prices?",
    "products.printUpdatedTitle": "Prices updated",
    "products.printer": "Printer",
    "products.savingPrices": "Saving…",
    "products.service": "Print service",
    "receipt.labels.partnerDebt": "Partner debt",
    "settings.labelTemplates.addService": "Add print service",
    "settings.labelTemplates.cancelEdit": "Cancel",
    "settings.labelTemplates.editService": "Edit print service",
    "settings.labelTemplates.editor.barcodeWidth": "Barcode width (%)",
    "settings.labelTemplates.newService": "New print service",
    "settings.labelTemplates.noServices": "No print services yet.",
    "settings.labelTemplates.saveService": "Save",
    "settings.labelTemplates.serviceHint": (
        "Each print service uses the shared gateway token. "
        "The printer name must match a logical label printer in the Windows Print Service."
    ),
    "settings.labelTemplates.serviceName": "Display name",
    "settings.labelTemplates.services": "Print services",
    "settings.labelTemplates.stationMatches": "Matches {{names}}",
    "settings.labelTemplates.stationNoMatch": "Does not match a saved print service",
    "settings.labelTemplates.tabPrinter": "Printer",
    "settings.labelTemplates.tabTemplates": "Templates",
    "settings.pos.showLastPurchaseCost": "Show last purchase cost",
    "settings.pos.showLastPurchaseCostDesc": "Show last purchase cost on Sell and Products catalog cards.",
    "settings.receiptTemplates.partnerDebt": "Partner debt",
    "settings.receiptTemplates.partnerDebtNegativeOnly": "Only negative balance",
    "stock.item.group.create": "Create group",
    "stock.item.group.edit": "Edit group",
    "stock.item.group.empty": "No groups found",
    "stock.item.group.errors.create": "Failed to create group",
    "stock.item.group.errors.update": "Failed to update group",
    "stock.item.group.fields.name": "Name",
    "stock.item.group.fields.parent": "Parent group",
    "stock.item.group.nameRequired": "Enter a group name",
    "stock.item.group.parentInvalid": "A group cannot be its own parent",
    "stock.item.group.root": "Root (no parent)",
    "stock.item.group.search": "Search groups…",
    "stock.item.updated": "Product updated",
    "table.columns": "Column settings",
    "table.sort.asc": "{{name}}: ascending",
    "table.sort.desc": "{{name}}: descending",
    "table.sort.none": "{{name}}: not sorted",
    "users.settings.showLastPurchaseCost": "Show last purchase cost",
    "users.settings.showLastPurchaseCostDesc": "Show last purchase cost on Sell and Products catalog cards.",
}

# Keys already in en.json but still English (or missing) in locale overrides
GAP_EN_KEYS = [
    "auth.confirmPassword",
    "auth.fillAllFields",
    "auth.integrationAuthorizing",
    "auth.integrationErrorTitle",
    "auth.integrationSetPasswordWaiting",
    "auth.loginWithRegos",
    "auth.passwordLettersAndDigits",
    "auth.passwordMismatch",
    "auth.savePassword",
    "auth.saving",
    "auth.setInitialPasswordDesc",
    "auth.setInitialPasswordTitle",
    "common.print",
    "meta.priceDocumentDetailTitle",
    "meta.priceDocumentsDescription",
    "meta.priceDocumentsTitle",
    "partnerApp.scrollForMore",
    "partnerTelegram.menuButton",
    "prices.allPriceTypes",
    "prices.basePrice",
    "prices.errors.load",
    "prices.newPrice",
    "prices.priceType",
    "prices.subtitle",
    "prices.title",
    "products.copyStockToPrintQty",
    "settings.defaults.refreshed",
    "settings.labelTemplates.download",
    "settings.labelTemplates.editor.barcodeHeight",
    "settings.labelTemplates.editor.css",
    "settings.labelTemplates.editor.helpers",
    "settings.labelTemplates.editor.landscape",
    "settings.labelTemplates.editor.orientation",
    "settings.labelTemplates.editor.portrait",
    "settings.labelTemplates.editor.qrSize",
    "settings.labelTemplates.editor.tabCss",
    "settings.labelTemplates.editor.tabHtml",
    "settings.labelTemplates.editor.tabVisual",
    "settings.labelTemplates.editor.visual",
    "settings.labelTemplates.editor.visualHint",
    "settings.labelTemplates.editor.zoom",
    "settings.labelTemplates.editor.zoomFit",
    "settings.labelTemplates.editor.zoomIn",
    "settings.labelTemplates.editor.zoomOut",
    "settings.labelTemplates.editor.zoomReset",
    "settings.labelTemplates.previewClose",
    "settings.labelTemplates.previewTitle",
    "settings.labelTemplates.sampleHint",
    "settings.labelTemplates.sampleTitle",
    "settings.labelTemplates.tabSamples",
    "settings.labelTemplates.use",
    "settings.labelTemplates.view",
    "stock.editLine.markup",
    "telegram.partnerReceipt.debt",
    "telegram.partnerReceipt.debtLine",
    "users.permissions.codes.prices.read",
    "users.permissions.codes.prices.write",
    "users.permissions.descriptions.prices.read",
    "users.permissions.descriptions.prices.write",
    "users.settings.allowedCategoriesAll",
]

NEW_RU: dict[str, str] = {
    # NEW_EN
    "auth.or": "или",
    "auth.signOut": "Выйти",
    "auth.ssoFailed": "Не удалось войти через REGOS",
    "common.no": "Нет",
    "common.yes": "Да",
    "nav.main": "Главное",
    "partnerApp.activePartner": "Партнёр",
    "partnerApp.inactive": "Этот аккаунт Telegram деактивирован. Свяжитесь с компанией.",
    "partnerTelegram.activate": "Активировать",
    "partnerTelegram.activePartner": "активный",
    "partnerTelegram.deactivate": "Деактивировать",
    "partnerTelegram.deleteAccountConfirm": "Удалить этот аккаунт Telegram? Это действие нельзя отменить.",
    "partnerTelegram.removePartner": "Убрать партнёра",
    "partnerTelegram.searchAccounts": "Поиск по имени, телефону, username или партнёру",
    "partnerTelegram.searchEmpty": "Нет аккаунтов по этому запросу.",
    "partnerTelegram.setActivePartner": "Сделать активным партнёром",
    "products.changePrices": "Изменить цены",
    "products.changePricesTitle": "Изменение цен",
    "products.choosePrinter": "Выберите подключённый принтер этикеток.",
    "products.connectedPrinter": "Служба печати подключена. Этикетки печатаются на {{name}}.",
    "products.currentPrice": "Текущая цена",
    "products.errors.changePrices": "Не удалось обновить цены",
    "products.errors.invalidPrice": "Введите цену ноль или больше.",
    "products.history": "История",
    "products.history.col.cost": "Себестоимость",
    "products.history.col.date": "Дата",
    "products.history.col.document": "Документ",
    "products.history.col.price": "Цена",
    "products.history.col.qty": "Кол-во",
    "products.history.col.stock": "Склад",
    "products.history.col.type": "Тип",
    "products.history.empty": "Нет истории движений по этому товару",
    "products.history.errors.load": "Не удалось загрузить историю",
    "products.history.loadMore": "Загрузить ещё",
    "products.history.shown": "{{n}} из {{m}}",
    "products.history.titleNamed": "История — {{name}}",
    "products.menu": "Действия с товаром",
    "products.newPrice": "Новая цена для {{name}}",
    "products.noConnectedPrinters": "Нет подключённых принтеров этикеток. Подключите службу печати, чтобы выбрать принтер по умолчанию.",
    "products.noPriceChanges": "Измените хотя бы одну цену.",
    "products.noPrinterPreference": "Без предпочтений",
    "products.priceTypeRequired": "Выберите тип цены",
    "products.printUpdatedPrompt": "Напечатать этикетки с обновлёнными ценами?",
    "products.printUpdatedTitle": "Цены обновлены",
    "products.printer": "Принтер",
    "products.savingPrices": "Сохранение…",
    "products.service": "Служба печати",
    "receipt.labels.partnerDebt": "Долг партнёра",
    "settings.labelTemplates.addService": "Добавить службу печати",
    "settings.labelTemplates.cancelEdit": "Отмена",
    "settings.labelTemplates.editService": "Редактировать службу печати",
    "settings.labelTemplates.editor.barcodeWidth": "Ширина штрихкода (%)",
    "settings.labelTemplates.newService": "Новая служба печати",
    "settings.labelTemplates.noServices": "Служб печати пока нет.",
    "settings.labelTemplates.saveService": "Сохранить",
    "settings.labelTemplates.serviceHint": (
        "Каждая служба печати использует общий токен шлюза. "
        "Имя принтера должно совпадать с логическим принтером этикеток в Windows Print Service."
    ),
    "settings.labelTemplates.serviceName": "Отображаемое имя",
    "settings.labelTemplates.services": "Службы печати",
    "settings.labelTemplates.stationMatches": "Совпадает с {{names}}",
    "settings.labelTemplates.stationNoMatch": "Не совпадает с сохранённой службой печати",
    "settings.labelTemplates.tabPrinter": "Принтер",
    "settings.labelTemplates.tabTemplates": "Шаблоны",
    "settings.pos.showLastPurchaseCost": "Показывать себестоимость последней закупки",
    "settings.pos.showLastPurchaseCostDesc": "Показывать себестоимость последней закупки на карточках в Продажах и Товарах.",
    "settings.receiptTemplates.partnerDebt": "Долг партнёра",
    "settings.receiptTemplates.partnerDebtNegativeOnly": "Только отрицательный баланс",
    "stock.item.group.create": "Создать группу",
    "stock.item.group.edit": "Редактировать группу",
    "stock.item.group.empty": "Группы не найдены",
    "stock.item.group.errors.create": "Не удалось создать группу",
    "stock.item.group.errors.update": "Не удалось обновить группу",
    "stock.item.group.fields.name": "Название",
    "stock.item.group.fields.parent": "Родительская группа",
    "stock.item.group.nameRequired": "Введите название группы",
    "stock.item.group.parentInvalid": "Группа не может быть своим родителем",
    "stock.item.group.root": "Корень (без родителя)",
    "stock.item.group.search": "Поиск групп…",
    "stock.item.updated": "Товар обновлён",
    "table.columns": "Настройка столбцов",
    "table.sort.asc": "{{name}}: по возрастанию",
    "table.sort.desc": "{{name}}: по убыванию",
    "table.sort.none": "{{name}}: без сортировки",
    "users.settings.showLastPurchaseCost": "Показывать себестоимость последней закупки",
    "users.settings.showLastPurchaseCostDesc": "Показывать себестоимость последней закупки на карточках в Продажах и Товарах.",
    # GAP keys
    "auth.confirmPassword": "Подтвердите пароль",
    "auth.fillAllFields": "Заполните все поля",
    "auth.integrationAuthorizing": "Авторизация интеграции…",
    "auth.integrationErrorTitle": "Ошибка авторизации",
    "auth.integrationSetPasswordWaiting": "Задайте пароль, чтобы завершить регистрацию",
    "auth.loginWithRegos": "Войти через Regos",
    "auth.passwordLettersAndDigits": "Пароль должен содержать буквы и цифры",
    "auth.passwordMismatch": "Пароли не совпадают",
    "auth.savePassword": "Сохранить пароль",
    "auth.saving": "Сохранение…",
    "auth.setInitialPasswordDesc": "Задайте пароль, чтобы завершить вход через Regos.",
    "auth.setInitialPasswordTitle": "Задайте пароль",
    "common.print": "Печать",
    "meta.priceDocumentDetailTitle": "Документ цен · Regos Optom",
    "meta.priceDocumentsDescription": "Просмотр документов установки цен.",
    "meta.priceDocumentsTitle": "Документы цен · Regos Optom",
    "partnerApp.scrollForMore": "Прокрутите, чтобы увидеть больше товаров",
    "partnerTelegram.menuButton": "Приложение",
    "prices.allPriceTypes": "Все типы цен",
    "prices.basePrice": "Базовая цена",
    "prices.errors.load": "Не удалось загрузить документы",
    "prices.newPrice": "Новая цена",
    "prices.priceType": "Тип цены",
    "prices.subtitle": "{{count}} документов · {{period}}",
    "prices.title": "Документы цен",
    "products.copyStockToPrintQty": "Скопировать количество в количество для печати",
    "settings.defaults.refreshed": "Значения по умолчанию Regos обновлены из Regos",
    "settings.labelTemplates.download": "Скачать",
    "settings.labelTemplates.editor.barcodeHeight": "Высота штрихкода (мм)",
    "settings.labelTemplates.editor.css": "CSS",
    "settings.labelTemplates.editor.helpers": "Подсказки",
    "settings.labelTemplates.editor.landscape": "Альбомная",
    "settings.labelTemplates.editor.orientation": "Ориентация",
    "settings.labelTemplates.editor.portrait": "Книжная",
    "settings.labelTemplates.editor.qrSize": "Размер QR (мм)",
    "settings.labelTemplates.editor.tabCss": "CSS",
    "settings.labelTemplates.editor.tabHtml": "HTML",
    "settings.labelTemplates.editor.tabVisual": "Визуальный",
    "settings.labelTemplates.editor.visual": "Визуальный",
    "settings.labelTemplates.editor.visualHint": (
        "Визуальный редактор и HTML/CSS правят один шаблон. "
        "Переключайте вкладки, чтобы уточнить разметку или стили."
    ),
    "settings.labelTemplates.editor.zoom": "Масштаб",
    "settings.labelTemplates.editor.zoomFit": "Вписать",
    "settings.labelTemplates.editor.zoomIn": "Увеличить",
    "settings.labelTemplates.editor.zoomOut": "Уменьшить",
    "settings.labelTemplates.editor.zoomReset": "100%",
    "settings.labelTemplates.previewClose": "Закрыть",
    "settings.labelTemplates.previewTitle": "Просмотр образца шаблона",
    "settings.labelTemplates.sampleHint": (
        "Просмотрите распространённые размеры бумаги. "
        "Откройте предпросмотр с примером товара или используйте пресет как новый шаблон."
    ),
    "settings.labelTemplates.sampleTitle": "Образцы шаблонов",
    "settings.labelTemplates.tabSamples": "Образцы шаблонов",
    "settings.labelTemplates.use": "Использовать",
    "settings.labelTemplates.view": "Просмотр",
    "stock.editLine.markup": "Наценка %",
    "telegram.partnerReceipt.debt": "Задолженность",
    "telegram.partnerReceipt.debtLine": "{{firm}} ({{currency}}): {{amount}}",
    "users.permissions.codes.prices.read": "Просмотр документов цен",
    "users.permissions.codes.prices.write": "Изменение цен",
    "users.permissions.descriptions.prices.read": "Просмотр документов установки цен",
    "users.permissions.descriptions.prices.write": "Изменение цен товаров",
    "users.settings.allowedCategoriesAll": "Все",
}

NEW_UZ: dict[str, str] = {
    "auth.or": "yoki",
    "auth.signOut": "Chiqish",
    "auth.ssoFailed": "REGOS orqali kirib bo‘lmadi",
    "common.no": "Yo‘q",
    "common.yes": "Ha",
    "nav.main": "Asosiy",
    "partnerApp.activePartner": "Hamkor",
    "partnerApp.inactive": "Bu Telegram akkaunti o‘chirilgan. Kompaniya bilan bog‘laning.",
    "partnerTelegram.activate": "Faollashtirish",
    "partnerTelegram.activePartner": "faol",
    "partnerTelegram.deactivate": "O‘chirish",
    "partnerTelegram.deleteAccountConfirm": "Bu Telegram akkauntini o‘chirishni xohlaysizmi? Bu amalni qaytarib bo‘lmaydi.",
    "partnerTelegram.removePartner": "Hamkorni olib tashlash",
    "partnerTelegram.searchAccounts": "Ism, telefon, username yoki hamkor bo‘yicha qidirish",
    "partnerTelegram.searchEmpty": "Bu qidiruvga mos akkaunt yo‘q.",
    "partnerTelegram.setActivePartner": "Faol hamkor qilish",
    "products.changePrices": "Narxlarni o‘zgartirish",
    "products.changePricesTitle": "Narxlarni o‘zgartirish",
    "products.choosePrinter": "Ulangan yorliq printerini tanlang.",
    "products.connectedPrinter": "Chop etish xizmati ulangan. Yorliqlar {{name}} da chop etiladi.",
    "products.currentPrice": "Joriy narx",
    "products.errors.changePrices": "Narxlarni yangilab bo‘lmadi",
    "products.errors.invalidPrice": "Nol yoki undan katta narx kiriting.",
    "products.history": "Tarix",
    "products.history.col.cost": "Tannarx",
    "products.history.col.date": "Sana",
    "products.history.col.document": "Hujjat",
    "products.history.col.price": "Narx",
    "products.history.col.qty": "Soni",
    "products.history.col.stock": "Ombor",
    "products.history.col.type": "Tur",
    "products.history.empty": "Bu mahsulot bo‘yicha harakatlar tarixi yo‘q",
    "products.history.errors.load": "Tarixni yuklab bo‘lmadi",
    "products.history.loadMore": "Yana yuklash",
    "products.history.shown": "{{n}} / {{m}}",
    "products.history.titleNamed": "Tarix — {{name}}",
    "products.menu": "Mahsulot amallari",
    "products.newPrice": "{{name}} uchun yangi narx",
    "products.noConnectedPrinters": "Ulangan yorliq printerlari yo‘q. Standartni tanlash uchun Print Service ni ulang.",
    "products.noPriceChanges": "Kamida bitta narxni o‘zgartiring.",
    "products.noPrinterPreference": "Afzallik yo‘q",
    "products.priceTypeRequired": "Narx turini tanlang",
    "products.printUpdatedPrompt": "Yangilangan narxlar bilan yorliqlarni chop etilsinmi?",
    "products.printUpdatedTitle": "Narxlar yangilandi",
    "products.printer": "Printer",
    "products.savingPrices": "Saqlanmoqda…",
    "products.service": "Chop etish xizmati",
    "receipt.labels.partnerDebt": "Hamkor qarzi",
    "settings.labelTemplates.addService": "Chop etish xizmati qo‘shish",
    "settings.labelTemplates.cancelEdit": "Bekor qilish",
    "settings.labelTemplates.editService": "Chop etish xizmatini tahrirlash",
    "settings.labelTemplates.editor.barcodeWidth": "Shtrixkod kengligi (%)",
    "settings.labelTemplates.newService": "Yangi chop etish xizmati",
    "settings.labelTemplates.noServices": "Hali chop etish xizmatlari yo‘q.",
    "settings.labelTemplates.saveService": "Saqlash",
    "settings.labelTemplates.serviceHint": (
        "Har bir chop etish xizmati umumiy gateway tokenidan foydalanadi. "
        "Printer nomi Windows Print Service dagi mantiqiy yorliq printeriga mos kelishi kerak."
    ),
    "settings.labelTemplates.serviceName": "Ko‘rsatiladigan nom",
    "settings.labelTemplates.services": "Chop etish xizmatlari",
    "settings.labelTemplates.stationMatches": "{{names}} bilan mos",
    "settings.labelTemplates.stationNoMatch": "Saqlangan chop etish xizmatiga mos kelmaydi",
    "settings.labelTemplates.tabPrinter": "Printer",
    "settings.labelTemplates.tabTemplates": "Shablonlar",
    "settings.pos.showLastPurchaseCost": "Oxirgi xarid tannarxini ko‘rsatish",
    "settings.pos.showLastPurchaseCostDesc": "Savdo va Mahsulotlar katalog kartalarida oxirgi xarid tannarxini ko‘rsatish.",
    "settings.receiptTemplates.partnerDebt": "Hamkor qarzi",
    "settings.receiptTemplates.partnerDebtNegativeOnly": "Faqat manfiy balans",
    "stock.item.group.create": "Guruh yaratish",
    "stock.item.group.edit": "Guruhni tahrirlash",
    "stock.item.group.empty": "Guruhlar topilmadi",
    "stock.item.group.errors.create": "Guruh yaratib bo‘lmadi",
    "stock.item.group.errors.update": "Guruhni yangilab bo‘lmadi",
    "stock.item.group.fields.name": "Nom",
    "stock.item.group.fields.parent": "Ota guruh",
    "stock.item.group.nameRequired": "Guruh nomini kiriting",
    "stock.item.group.parentInvalid": "Guruh o‘zining otasi bo‘la olmaydi",
    "stock.item.group.root": "Ildiz (otasiz)",
    "stock.item.group.search": "Guruhlarni qidirish…",
    "stock.item.updated": "Mahsulot yangilandi",
    "table.columns": "Ustun sozlamalari",
    "table.sort.asc": "{{name}}: o‘sish bo‘yicha",
    "table.sort.desc": "{{name}}: kamayish bo‘yicha",
    "table.sort.none": "{{name}}: saralanmagan",
    "users.settings.showLastPurchaseCost": "Oxirgi xarid tannarxini ko‘rsatish",
    "users.settings.showLastPurchaseCostDesc": "Savdo va Mahsulotlar katalog kartalarida oxirgi xarid tannarxini ko‘rsatish.",
    "auth.confirmPassword": "Parolni tasdiqlang",
    "auth.fillAllFields": "Barcha maydonlarni to‘ldiring",
    "auth.integrationAuthorizing": "Integratsiya avtorizatsiyasi…",
    "auth.integrationErrorTitle": "Avtorizatsiya muvaffaqiyatsiz",
    "auth.integrationSetPasswordWaiting": "Ro‘yxatdan o‘tishni yakunlash uchun parol o‘rnating",
    "auth.loginWithRegos": "Regos orqali kirish",
    "auth.passwordLettersAndDigits": "Parolda harflar va raqamlar bo‘lishi kerak",
    "auth.passwordMismatch": "Parollar mos kelmaydi",
    "auth.savePassword": "Parolni saqlash",
    "auth.saving": "Saqlanmoqda…",
    "auth.setInitialPasswordDesc": "Regos orqali kirishni yakunlash uchun parol tanlang.",
    "auth.setInitialPasswordTitle": "Parolingizni o‘rnating",
    "common.print": "Chop etish",
    "meta.priceDocumentDetailTitle": "Narx hujjati · Regos Optom",
    "meta.priceDocumentsDescription": "Narx o‘rnatish hujjatlarini ko‘rish.",
    "meta.priceDocumentsTitle": "Narx hujjatlari · Regos Optom",
    "partnerApp.scrollForMore": "Ko‘proq mahsulotlar uchun aylantiring",
    "partnerTelegram.menuButton": "Ilova",
    "prices.allPriceTypes": "Barcha narx turlari",
    "prices.basePrice": "Asosiy narx",
    "prices.errors.load": "Hujjatlarni yuklab bo‘lmadi",
    "prices.newPrice": "Yangi narx",
    "prices.priceType": "Narx turi",
    "prices.subtitle": "{{count}} ta hujjat · {{period}}",
    "prices.title": "Narx hujjatlari",
    "products.copyStockToPrintQty": "Miqdorni chop etish miqdoriga nusxalash",
    "settings.defaults.refreshed": "Regos standartlari Regos dan yangilandi",
    "settings.labelTemplates.download": "Yuklab olish",
    "settings.labelTemplates.editor.barcodeHeight": "Shtrixkod balandligi (mm)",
    "settings.labelTemplates.editor.css": "CSS",
    "settings.labelTemplates.editor.helpers": "Yordamchilar",
    "settings.labelTemplates.editor.landscape": "Landshaft",
    "settings.labelTemplates.editor.orientation": "Orientatsiya",
    "settings.labelTemplates.editor.portrait": "Portret",
    "settings.labelTemplates.editor.qrSize": "QR o‘lchami (mm)",
    "settings.labelTemplates.editor.tabCss": "CSS",
    "settings.labelTemplates.editor.tabHtml": "HTML",
    "settings.labelTemplates.editor.tabVisual": "Vizual",
    "settings.labelTemplates.editor.visual": "Vizual",
    "settings.labelTemplates.editor.visualHint": (
        "Vizual va HTML/CSS bir xil shablonni tahrirlaydi. "
        "Belgilash yoki stillarni aniqlash uchun vkladkalarni almashtiring."
    ),
    "settings.labelTemplates.editor.zoom": "Masshtab",
    "settings.labelTemplates.editor.zoomFit": "Sig‘dirish",
    "settings.labelTemplates.editor.zoomIn": "Kattalashtirish",
    "settings.labelTemplates.editor.zoomOut": "Kichiklashtirish",
    "settings.labelTemplates.editor.zoomReset": "100%",
    "settings.labelTemplates.previewClose": "Yopish",
    "settings.labelTemplates.previewTitle": "Namuna shablon ko‘rinishi",
    "settings.labelTemplates.sampleHint": (
        "Keng tarqalgan qog‘oz o‘lchamlarini ko‘rib chiqing. "
        "Namuna mahsulot bilan ko‘ring yoki presetni yangi shablon sifatida ishlating."
    ),
    "settings.labelTemplates.sampleTitle": "Namuna shablonlar",
    "settings.labelTemplates.tabSamples": "Namuna shablonlar",
    "settings.labelTemplates.use": "Ishlatish",
    "settings.labelTemplates.view": "Ko‘rish",
    "stock.editLine.markup": "Ustama %",
    "telegram.partnerReceipt.debt": "Qarz",
    "telegram.partnerReceipt.debtLine": "{{firm}} ({{currency}}): {{amount}}",
    "users.permissions.codes.prices.read": "Narx hujjatlarini ko‘rish",
    "users.permissions.codes.prices.write": "Narxlarni o‘zgartirish",
    "users.permissions.descriptions.prices.read": "Narx o‘rnatish hujjatlarini ko‘rish",
    "users.permissions.descriptions.prices.write": "Mahsulot narxlarini o‘zgartirish",
    "users.settings.allowedCategoriesAll": "Barchasi",
}

NEW_TJ: dict[str, str] = {
    "auth.or": "ё",
    "auth.signOut": "Баромадан",
    "auth.ssoFailed": "Воридшавӣ тавассути REGOS ноком шуд",
    "common.no": "Не",
    "common.yes": "Ҳа",
    "nav.main": "Асосӣ",
    "partnerApp.activePartner": "Шарик",
    "partnerApp.inactive": "Ин ҳисоби Telegram ғайрифаъол аст. Бо ширкат тамос гиред.",
    "partnerTelegram.activate": "Фаъол кардан",
    "partnerTelegram.activePartner": "фаъол",
    "partnerTelegram.deactivate": "Ғайрифаъол кардан",
    "partnerTelegram.deleteAccountConfirm": "Ин ҳисоби Telegram-ро нест кунем? Ин амалро бозгардондан мумкин нест.",
    "partnerTelegram.removePartner": "Шарикро хориҷ кардан",
    "partnerTelegram.searchAccounts": "Ҷустуҷӯ аз рӯи ном, телефон, username ё шарик",
    "partnerTelegram.searchEmpty": "Ягон ҳисоб ба ин ҷустуҷӯ мувофиқат намекунад.",
    "partnerTelegram.setActivePartner": "Ҳамчун шарики фаъол таъин кардан",
    "products.changePrices": "Тағйири нархҳо",
    "products.changePricesTitle": "Тағйири нархҳо",
    "products.choosePrinter": "Принтери пайвастшудаи тамғаро интихоб кунед.",
    "products.connectedPrinter": "Хидмати чоп пайваст аст. Тамғаҳо дар {{name}} чоп мешаванд.",
    "products.currentPrice": "Нархи ҷорӣ",
    "products.errors.changePrices": "Нархҳоро навсозӣ карда нашуд",
    "products.errors.invalidPrice": "Нархи сифр ё зиёдро ворид кунед.",
    "products.history": "Таърих",
    "products.history.col.cost": "Арзиш",
    "products.history.col.date": "Сана",
    "products.history.col.document": "Ҳуҷҷат",
    "products.history.col.price": "Нарх",
    "products.history.col.qty": "Миқдор",
    "products.history.col.stock": "Анбор",
    "products.history.col.type": "Навъ",
    "products.history.empty": "Барои ин мол таърихи ҳаракат нест",
    "products.history.errors.load": "Таърихро бор карда нашуд",
    "products.history.loadMore": "Бештар бор кардан",
    "products.history.shown": "{{n}} аз {{m}}",
    "products.history.titleNamed": "Таърих — {{name}}",
    "products.menu": "Амалҳои мол",
    "products.newPrice": "Нархи нав барои {{name}}",
    "products.noConnectedPrinters": "Принтерҳои тамға пайваст нестанд. Барои интихоби пешфарз Print Service-ро пайваст кунед.",
    "products.noPriceChanges": "Ҳадди ақал як нархро тағйир диҳед.",
    "products.noPrinterPreference": "Бе афзалият",
    "products.priceTypeRequired": "Навъи нархро интихоб кунед",
    "products.printUpdatedPrompt": "Тамғаҳо бо нархҳои навшуда чоп шаванд?",
    "products.printUpdatedTitle": "Нархҳо нав шуданд",
    "products.printer": "Принтер",
    "products.savingPrices": "Нигоҳ дошта мешавад…",
    "products.service": "Хидмати чоп",
    "receipt.labels.partnerDebt": "Қарзи шарик",
    "settings.labelTemplates.addService": "Хидмати чоп илова кардан",
    "settings.labelTemplates.cancelEdit": "Бекор кардан",
    "settings.labelTemplates.editService": "Таҳрири хидмати чоп",
    "settings.labelTemplates.editor.barcodeWidth": "Паҳнои штрихкод (%)",
    "settings.labelTemplates.newService": "Хидмати нави чоп",
    "settings.labelTemplates.noServices": "Ҳанӯз хидматҳои чоп нестанд.",
    "settings.labelTemplates.saveService": "Нигоҳ доштан",
    "settings.labelTemplates.serviceHint": (
        "Ҳар хидмати чоп аз токени муштараки шлюз истифода мебарад. "
        "Номи принтер бояд бо принтери мантиқии тамға дар Windows Print Service мувофиқат кунад."
    ),
    "settings.labelTemplates.serviceName": "Номи намоишӣ",
    "settings.labelTemplates.services": "Хидматҳои чоп",
    "settings.labelTemplates.stationMatches": "Мувофиқ бо {{names}}",
    "settings.labelTemplates.stationNoMatch": "Бо хидмати захирашудаи чоп мувофиқат намекунад",
    "settings.labelTemplates.tabPrinter": "Принтер",
    "settings.labelTemplates.tabTemplates": "Шаблонҳо",
    "settings.pos.showLastPurchaseCost": "Арзиши охирини харидро нишон додан",
    "settings.pos.showLastPurchaseCostDesc": "Арзиши охирини харидро дар кортҳои Фурӯш ва Молҳо нишон диҳед.",
    "settings.receiptTemplates.partnerDebt": "Қарзи шарик",
    "settings.receiptTemplates.partnerDebtNegativeOnly": "Танҳо тавозуни манфӣ",
    "stock.item.group.create": "Эҷоди гурӯҳ",
    "stock.item.group.edit": "Таҳрири гурӯҳ",
    "stock.item.group.empty": "Гурӯҳҳо ёфт нашуданд",
    "stock.item.group.errors.create": "Гурӯҳ эҷод карда нашуд",
    "stock.item.group.errors.update": "Гурӯҳ навсозӣ карда нашуд",
    "stock.item.group.fields.name": "Ном",
    "stock.item.group.fields.parent": "Гурӯҳи асосӣ",
    "stock.item.group.nameRequired": "Номи гурӯҳро ворид кунед",
    "stock.item.group.parentInvalid": "Гурӯҳ наметавонад падари худаш бошад",
    "stock.item.group.root": "Реша (бе падар)",
    "stock.item.group.search": "Ҷустуҷӯи гурӯҳҳо…",
    "stock.item.updated": "Мол нав шуд",
    "table.columns": "Танзими сутунҳо",
    "table.sort.asc": "{{name}}: афзоянда",
    "table.sort.desc": "{{name}}: коҳишёбанда",
    "table.sort.none": "{{name}}: бе мураттабсозӣ",
    "users.settings.showLastPurchaseCost": "Арзиши охирини харидро нишон додан",
    "users.settings.showLastPurchaseCostDesc": "Арзиши охирини харидро дар кортҳои Фурӯш ва Молҳо нишон диҳед.",
    "auth.confirmPassword": "Паролро тасдиқ кунед",
    "auth.fillAllFields": "Ҳамаи майдонҳоро пур кунед",
    "auth.integrationAuthorizing": "Авторизатсияи интегратсия…",
    "auth.integrationErrorTitle": "Авторизатсия ноком шуд",
    "auth.integrationSetPasswordWaiting": "Барои анҷоми бақайдгирӣ парол гузоред",
    "auth.loginWithRegos": "Воридшавӣ тавассути Regos",
    "auth.passwordLettersAndDigits": "Парол бояд ҳарфҳо ва рақамҳо дошта бошад",
    "auth.passwordMismatch": "Паролҳо мувофиқат намекунанд",
    "auth.savePassword": "Паролро нигоҳ доштан",
    "auth.saving": "Нигоҳ дошта мешавад…",
    "auth.setInitialPasswordDesc": "Барои анҷоми воридшавӣ тавассути Regos парол интихоб кунед.",
    "auth.setInitialPasswordTitle": "Пароли худро гузоред",
    "common.print": "Чоп",
    "meta.priceDocumentDetailTitle": "Ҳуҷҷати нарх · Regos Optom",
    "meta.priceDocumentsDescription": "Дидани ҳуҷҷатҳои муқаррар кардани нарх.",
    "meta.priceDocumentsTitle": "Ҳуҷҷатҳои нарх · Regos Optom",
    "partnerApp.scrollForMore": "Барои молҳои бештар ҳаракат диҳед",
    "partnerTelegram.menuButton": "Барнома",
    "prices.allPriceTypes": "Ҳамаи навъҳои нарх",
    "prices.basePrice": "Нархи асосӣ",
    "prices.errors.load": "Ҳуҷҷатҳоро бор карда нашуд",
    "prices.newPrice": "Нархи нав",
    "prices.priceType": "Навъи нарх",
    "prices.subtitle": "{{count}} ҳуҷҷат · {{period}}",
    "prices.title": "Ҳуҷҷатҳои нарх",
    "products.copyStockToPrintQty": "Миқдорро ба миқдори чоп нусхабардорӣ кунед",
    "settings.defaults.refreshed": "Стандартҳои Regos аз Regos нав шуданд",
    "settings.labelTemplates.download": "Боргирӣ",
    "settings.labelTemplates.editor.barcodeHeight": "Баландии штрихкод (мм)",
    "settings.labelTemplates.editor.css": "CSS",
    "settings.labelTemplates.editor.helpers": "Ёрдамчиҳо",
    "settings.labelTemplates.editor.landscape": "Уфуқӣ",
    "settings.labelTemplates.editor.orientation": "Ориентатсия",
    "settings.labelTemplates.editor.portrait": "Амудӣ",
    "settings.labelTemplates.editor.qrSize": "Андозаи QR (мм)",
    "settings.labelTemplates.editor.tabCss": "CSS",
    "settings.labelTemplates.editor.tabHtml": "HTML",
    "settings.labelTemplates.editor.tabVisual": "Визуалӣ",
    "settings.labelTemplates.editor.visual": "Визуалӣ",
    "settings.labelTemplates.editor.visualHint": (
        "Визуалӣ ва HTML/CSS як шаблонро таҳрир мекунанд. "
        "Барои такмили аломатгузорӣ ё услубҳо ҷадвалҳоро иваз кунед."
    ),
    "settings.labelTemplates.editor.zoom": "Миқёс",
    "settings.labelTemplates.editor.zoomFit": "Мутобиқ",
    "settings.labelTemplates.editor.zoomIn": "Калон кардан",
    "settings.labelTemplates.editor.zoomOut": "Хурд кардан",
    "settings.labelTemplates.editor.zoomReset": "100%",
    "settings.labelTemplates.previewClose": "Пӯшидан",
    "settings.labelTemplates.previewTitle": "Пешнамоиши намунаи шаблон",
    "settings.labelTemplates.sampleHint": (
        "Андозаҳои маъмули қоғазро дида бароед. "
        "Бо маълумоти намунавии мол пешнамоиш кунед ё пресетро ҳамчун шаблони нав истифода баред."
    ),
    "settings.labelTemplates.sampleTitle": "Шаблонҳои намунавӣ",
    "settings.labelTemplates.tabSamples": "Шаблонҳои намунавӣ",
    "settings.labelTemplates.use": "Истифода",
    "settings.labelTemplates.view": "Дидан",
    "stock.editLine.markup": "Фоида %",
    "telegram.partnerReceipt.debt": "Қарзи боқимонда",
    "telegram.partnerReceipt.debtLine": "{{firm}} ({{currency}}): {{amount}}",
    "users.permissions.codes.prices.read": "Дидани ҳуҷҷатҳои нарх",
    "users.permissions.codes.prices.write": "Тағйири нархҳо",
    "users.permissions.descriptions.prices.read": "Дидани ҳуҷҷатҳои муқаррар кардани нарх",
    "users.permissions.descriptions.prices.write": "Тағйири нархҳои молҳо",
    "users.settings.allowedCategoriesAll": "Ҳама",
}

# Technical / brand strings that may match English intentionally
ALLOWED_ENGLISH = frozenset({
    "settings.labelTemplates.editor.css",
    "settings.labelTemplates.editor.tabCss",
    "settings.labelTemplates.editor.tabHtml",
    "settings.labelTemplates.editor.zoomReset",
    "settings.labelTemplates.editor.barcodeHeight",  # keep translated above
})

LOCALE_ADDITIONS = {
    "ru": NEW_RU,
    "uz": NEW_UZ,
    "tj": NEW_TJ,
}


def load_payload(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_payload(path: Path, translations: dict[str, str]) -> None:
    payload = {
        "version": VERSION,
        "last_updated": date.today().isoformat(),
        "translations": translations,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def ordered_merge(base: dict[str, str], additions: dict[str, str]) -> dict[str, str]:
    """Append missing keys; do not overwrite existing values."""
    out = dict(base)
    for key, value in additions.items():
        if key not in out:
            out[key] = value
    return out


def main() -> int:
    # Validate translation coverage before writing
    for lang, additions in LOCALE_ADDITIONS.items():
        missing_new = sorted(set(NEW_EN) - set(additions))
        missing_gap = sorted(set(GAP_EN_KEYS) - set(additions))
        if missing_new or missing_gap:
            print(f"ERROR {lang}: missing translations for new={missing_new[:5]} gap={missing_gap[:5]}", file=sys.stderr)
            return 1
        extra = sorted(set(additions) - set(NEW_EN) - set(GAP_EN_KEYS))
        if extra:
            print(f"WARN {lang}: unexpected keys in additions: {extra[:10]}")

    en_path = TRANSLATIONS_DIR / "en.json"
    en_payload = load_payload(en_path)
    en = en_payload["translations"]

    to_add = {k: v for k, v in NEW_EN.items() if k not in en}
    if to_add:
        en = ordered_merge(en, to_add)
        write_payload(en_path, en)
        print(f"en.json: added {len(to_add)} keys (now {len(en)})")
    else:
        print(f"en.json: already has all new keys ({len(en)})")

    for lang, additions in LOCALE_ADDITIONS.items():
        path = TRANSLATIONS_DIR / f"{lang}.json"
        payload = load_payload(path)
        translations = payload["translations"]

        # Prefer existing non-English value; else use addition; else keep/English
        merged: dict[str, str] = {}
        filled = 0
        updated = 0
        for key, en_val in en.items():
            if key in translations and translations[key] != en_val:
                merged[key] = translations[key]
            elif key in additions:
                merged[key] = additions[key]
                if key not in translations:
                    filled += 1
                elif translations[key] == en_val:
                    updated += 1
            elif key in translations:
                merged[key] = translations[key]
            else:
                merged[key] = en_val
                filled += 1
                print(f"  WARN {lang}: no translation for {key}, using English")

        write_payload(path, merged)
        print(f"{lang}.json: filled={filled}, updated_english={updated}, total={len(merged)}")

        LOCALES_DIR.mkdir(parents=True, exist_ok=True)
        override_path = LOCALES_DIR / f"{lang}.json"
        # Keep only non-English overrides (+ allowed English technical labels)
        overrides = {
            k: v
            for k, v in merged.items()
            if v != en.get(k) or k in {
                "language.uz", "language.ru", "language.en", "language.tj",
                "auth.title",
                "settings.receiptTemplates.htmlLabel",
                "settings.receiptTemplates.tabCss",
                "settings.receiptTemplates.tabHtml",
                "settings.exchangeRateSync.formula",
                "settings.telegram.webhook",
                "telegram.receipt.posPaymentLine",
                "telegramUsers.table.chatId",
                "settings.labelTemplates.editor.css",
                "settings.labelTemplates.editor.tabCss",
                "settings.labelTemplates.editor.tabHtml",
                "settings.labelTemplates.editor.zoomReset",
            }
        }
        # Actually scripts/locales historically store FULL locale maps matching en keys.
        # complete_locales.py expects full key parity. Write full merged map.
        override_path.write_text(
            json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"  wrote {override_path} ({len(merged)} keys)")

    print("\nRunning generate_translations.py…")
    result = subprocess.run(
        [sys.executable, str(Path(__file__).parent / "generate_translations.py")],
        check=False,
    )
    if result.returncode != 0:
        return result.returncode

    print("\nRunning complete_locales.py check…")
    check = subprocess.run(
        [sys.executable, str(Path(__file__).parent / "complete_locales.py")],
        check=False,
    )
    return check.returncode


if __name__ == "__main__":
    raise SystemExit(main())
