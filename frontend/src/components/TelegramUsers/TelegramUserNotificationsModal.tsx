import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "@/components/posui/Modal";
import { Button } from "@/components/posui/Button";
import { Checkbox } from "@/components/ui/checkbox";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatAuthError } from "@/store/auth";
import {
  TELEGRAM_RECEIPT_LANGUAGES,
  receiptLanguageLabelKey,
  type TelegramReceiptLanguage,
} from "@/lib/telegram-receipt-languages";
import { updateTelegramUser } from "@/lib/telegram-api";
import { fetchRegosReferenceOptions } from "@/lib/settings-api";
import {
  ALL_LEAF_NOTIFICATION_TYPES,
  TELEGRAM_NOTIFICATION_CATEGORIES,
  categorySelectionState,
  expandLegacyNotificationTypes,
  isSingleLeafCategory,
  notificationTypeDescriptionKey,
  notificationTypeLabelKey,
  subcategoryLabelKey,
  type TelegramNotificationLeaf,
} from "@/lib/telegram-notification-types";
import type { RegosDefaultOption } from "@/types/settings";
import type { TelegramUser } from "@/types/telegram";
import styles from "./TelegramUsers.module.css";

type Props = {
  open: boolean;
  token: string;
  user: TelegramUser | null;
  onClose: () => void;
  onSaved: (user: TelegramUser) => void;
};

type ScopePickerProps = {
  title: string;
  hint: string;
  allLabel: string;
  emptyLabel: string;
  options: RegosDefaultOption[];
  allSelected: boolean;
  selectedIds: number[];
  disabled: boolean;
  onChange: (value: { allSelected: boolean; selectedIds: number[] }) => void;
};

function ScopePicker({
  title,
  hint,
  allLabel,
  emptyLabel,
  options,
  allSelected,
  selectedIds,
  disabled,
  onChange,
}: ScopePickerProps) {
  const toggleOption = (optionId: number) => {
    if (allSelected) {
      onChange({
        allSelected: false,
        selectedIds: options.map((item) => item.id).filter((id) => id !== optionId),
      });
      return;
    }
    const nextIds = selectedIds.includes(optionId)
      ? selectedIds.filter((id) => id !== optionId)
      : [...selectedIds, optionId];
    const everySelected = nextIds.length === options.length && options.length > 0;
    onChange({
      allSelected: everySelected,
      selectedIds: everySelected ? options.map((item) => item.id) : nextIds,
    });
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      onChange({
        allSelected: true,
        selectedIds: options.map((item) => item.id),
      });
    } else {
      onChange({ allSelected: false, selectedIds: [] });
    }
  };

  return (
    <div className={styles.scopeSection}>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>{title}</span>
        <span className={styles.fieldHint}>{hint}</span>
      </div>
      <label className={styles.scopeAllRow}>
        <Checkbox
          checked={allSelected}
          disabled={disabled}
          onCheckedChange={(value) => handleSelectAll(value === true)}
        />
        <span>{allLabel}</span>
      </label>
      <div className={styles.scopeList}>
        {options.map((option) => (
          <label key={option.id} className={styles.scopeItem}>
            <Checkbox
              checked={allSelected || selectedIds.includes(option.id)}
              disabled={disabled}
              onCheckedChange={() => toggleOption(option.id)}
            />
            <span>{option.name}</span>
          </label>
        ))}
        {options.length === 0 && <div className={styles.scopeEmpty}>{emptyLabel}</div>}
      </div>
    </div>
  );
}

function isAllScopeIds(selectedIds: number[], options: RegosDefaultOption[]): boolean {
  return selectedIds.length === 0 || (options.length > 0 && selectedIds.length === options.length);
}

function scopeIdsForSave(allSelected: boolean, selectedIds: number[]): number[] {
  return allSelected ? [] : selectedIds;
}

export function TelegramUserNotificationsModal({
  open,
  token,
  user,
  onClose,
  onSaved,
}: Props) {
  const { t } = useLanguage();
  const [selectedLeaves, setSelectedLeaves] = useState<Set<TelegramNotificationLeaf>>(new Set());
  const [receiptLanguage, setReceiptLanguage] = useState<TelegramReceiptLanguage>("ru");
  const [isActive, setIsActive] = useState(true);
  const [allStocks, setAllStocks] = useState(true);
  const [selectedStockIds, setSelectedStockIds] = useState<number[]>([]);
  const [allCashiers, setAllCashiers] = useState(true);
  const [selectedCashierIds, setSelectedCashierIds] = useState<number[]>([]);
  const [allFirms, setAllFirms] = useState(true);
  const [selectedFirmIds, setSelectedFirmIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const referenceOptionsQuery = useQuery({
    queryKey: ["regos", "reference-options", token],
    queryFn: () => fetchRegosReferenceOptions(token),
    enabled: open && Boolean(token),
    staleTime: 60_000,
  });

  const warehouses = referenceOptionsQuery.data?.warehouses ?? [];
  const cashiers = referenceOptionsQuery.data?.attached_users ?? [];
  const firms = referenceOptionsQuery.data?.firms ?? [];

  useEffect(() => {
    if (!open || !user) return;
    setSelectedLeaves(new Set(expandLegacyNotificationTypes(user.notification_types)));
    setReceiptLanguage(user.receipt_language as TelegramReceiptLanguage);
    setIsActive(user.is_active);
    const stockIds = user.stock_ids ?? [];
    const cashierIds = user.cashier_ids ?? [];
    const firmIds = user.firm_ids ?? [];
    setAllStocks(stockIds.length === 0);
    setSelectedStockIds(stockIds);
    setAllCashiers(cashierIds.length === 0);
    setSelectedCashierIds(cashierIds);
    setAllFirms(firmIds.length === 0);
    setSelectedFirmIds(firmIds);
    setError("");
  }, [open, user]);

  useEffect(() => {
    if (!open || !user || warehouses.length === 0) return;
    if (user.stock_ids.length === 0) {
      setAllStocks(true);
      setSelectedStockIds(warehouses.map((item) => item.id));
      return;
    }
    setAllStocks(isAllScopeIds(user.stock_ids, warehouses));
  }, [open, user, warehouses]);

  useEffect(() => {
    if (!open || !user || cashiers.length === 0) return;
    if (user.cashier_ids.length === 0) {
      setAllCashiers(true);
      setSelectedCashierIds(cashiers.map((item) => item.id));
      return;
    }
    setAllCashiers(isAllScopeIds(user.cashier_ids, cashiers));
  }, [open, user, cashiers]);

  useEffect(() => {
    if (!open || !user || firms.length === 0) return;
    if (user.firm_ids.length === 0) {
      setAllFirms(true);
      setSelectedFirmIds(firms.map((item) => item.id));
      return;
    }
    setAllFirms(isAllScopeIds(user.firm_ids, firms));
  }, [open, user, firms]);

  const toggleLeaf = (leaf: TelegramNotificationLeaf, checked: boolean) => {
    setSelectedLeaves((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(leaf);
      } else {
        next.delete(leaf);
      }
      return next;
    });
  };

  const toggleCategory = (subcategories: readonly string[], checked: boolean) => {
    setSelectedLeaves((current) => {
      const next = new Set(current);
      for (const leaf of subcategories) {
        if (checked) {
          next.add(leaf as TelegramNotificationLeaf);
        } else {
          next.delete(leaf as TelegramNotificationLeaf);
        }
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!user || selectedLeaves.size === 0) {
      setError(
        t(
          "telegramUsers.notifications.selectAtLeastOne",
          "Select at least one notification type.",
        ),
      );
      return;
    }

    if (!allStocks && selectedStockIds.length === 0) {
      setError(
        t(
          "telegramUsers.scope.selectWarehouseOrAll",
          "Select at least one warehouse or choose all warehouses.",
        ),
      );
      return;
    }

    if (!allCashiers && selectedCashierIds.length === 0) {
      setError(
        t(
          "telegramUsers.scope.selectCashierOrAll",
          "Select at least one cashier or choose all cashiers.",
        ),
      );
      return;
    }

    if (!allFirms && selectedFirmIds.length === 0) {
      setError(
        t(
          "telegramUsers.scope.selectFirmOrAll",
          "Select at least one firm or choose all firms.",
        ),
      );
      return;
    }

    setSaving(true);
    setError("");
    try {
      const updated = await updateTelegramUser(token, user.id, {
        notification_types: ALL_LEAF_NOTIFICATION_TYPES.filter((leaf) =>
          selectedLeaves.has(leaf),
        ),
        is_active: isActive,
        receipt_language: receiptLanguage,
        stock_ids: scopeIdsForSave(allStocks, selectedStockIds),
        cashier_ids: scopeIdsForSave(allCashiers, selectedCashierIds),
        firm_ids: scopeIdsForSave(allFirms, selectedFirmIds),
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setSaving(false);
    }
  };

  const title = user
    ? t("telegramUsers.notifications.titleFor", "Notifications for {{name}}", {
        name:
          [user.first_name, user.last_name].filter(Boolean).join(" ") ||
          (user.username ? `@${user.username}` : `#${user.telegram_user_id}`),
      })
    : t("telegramUsers.notifications.title", "Notification settings");

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      <div className={styles.modalBody}>
        <p className={styles.modalHint}>
          {t(
            "telegramUsers.notifications.hint",
            "Choose which document notifications this subscriber receives from the Telegram bot.",
          )}
        </p>

        <label className={styles.activeToggle}>
          <Checkbox checked={isActive} onCheckedChange={(value) => setIsActive(value === true)} />
          <span>{t("telegramUsers.notifications.receiveMessages", "Receive Telegram messages")}</span>
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            {t("telegramUsers.receiptLanguage", "Receipt language")}
          </span>
          <span className={styles.fieldHint}>
            {t(
              "telegramUsers.receiptLanguageHint",
              "Language used for Telegram document notifications.",
            )}
          </span>
          <select
            className={styles.select}
            value={receiptLanguage}
            disabled={!isActive}
            onChange={(event) =>
              setReceiptLanguage(event.target.value as TelegramReceiptLanguage)
            }
          >
            {TELEGRAM_RECEIPT_LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {t(receiptLanguageLabelKey(language), language.toUpperCase())}
              </option>
            ))}
          </select>
        </label>

        <ScopePicker
          title={t("telegramUsers.scope.warehouses", "Warehouses")}
          hint={t(
            "telegramUsers.scope.warehousesHint",
            "Limit notifications to selected warehouses. Leave all selected to receive every warehouse.",
          )}
          allLabel={t("telegramUsers.scope.allWarehouses", "All warehouses")}
          emptyLabel={t("telegramUsers.scope.noWarehouses", "No warehouses available.")}
          options={warehouses}
          allSelected={allStocks}
          selectedIds={selectedStockIds}
          disabled={!isActive}
          onChange={({ allSelected, selectedIds }) => {
            setAllStocks(allSelected);
            setSelectedStockIds(selectedIds);
          }}
        />

        <ScopePicker
          title={t("telegramUsers.scope.cashiers", "Cashiers")}
          hint={t(
            "telegramUsers.scope.cashiersHint",
            "Limit POS and attached-user notifications to selected cashiers. Leave all selected to receive every cashier.",
          )}
          allLabel={t("telegramUsers.scope.allCashiers", "All cashiers")}
          emptyLabel={t("telegramUsers.scope.noCashiers", "No cashiers available.")}
          options={cashiers}
          allSelected={allCashiers}
          selectedIds={selectedCashierIds}
          disabled={!isActive}
          onChange={({ allSelected, selectedIds }) => {
            setAllCashiers(allSelected);
            setSelectedCashierIds(selectedIds);
          }}
        />

        <ScopePicker
          title={t("telegramUsers.scope.firms", "Firms")}
          hint={t(
            "telegramUsers.scope.firmsHint",
            "Limit payment notifications to selected firms. Leave all selected to receive every firm.",
          )}
          allLabel={t("telegramUsers.scope.allFirms", "All firms")}
          emptyLabel={t("telegramUsers.scope.noFirms", "No firms available.")}
          options={firms}
          allSelected={allFirms}
          selectedIds={selectedFirmIds}
          disabled={!isActive}
          onChange={({ allSelected, selectedIds }) => {
            setAllFirms(allSelected);
            setSelectedFirmIds(selectedIds);
          }}
        />

        <div className={styles.notificationList}>
          {TELEGRAM_NOTIFICATION_CATEGORIES.map((category) => {
            const singleLeaf = isSingleLeafCategory(category.subcategories);
            const parentChecked = categorySelectionState(selectedLeaves, category.subcategories);

            if (singleLeaf) {
              const leaf = category.subcategories[0] as TelegramNotificationLeaf;
              return (
                <label key={category.id} className={styles.notificationItem}>
                  <Checkbox
                    checked={selectedLeaves.has(leaf)}
                    disabled={!isActive}
                    onCheckedChange={(value) => toggleLeaf(leaf, value === true)}
                  />
                  <span className={styles.notificationText}>
                    <span className={styles.notificationLabel}>
                      {t(notificationTypeLabelKey(category.id), category.id)}
                    </span>
                    <span className={styles.notificationDescription}>
                      {t(notificationTypeDescriptionKey(category.id), "")}
                    </span>
                  </span>
                </label>
              );
            }

            return (
              <div key={category.id} className={styles.notificationCategory}>
                <label className={styles.notificationCategoryHeader}>
                  <Checkbox
                    checked={parentChecked}
                    disabled={!isActive}
                    onCheckedChange={(value) =>
                      toggleCategory(category.subcategories, value === true)
                    }
                  />
                  <span className={styles.notificationText}>
                    <span className={styles.notificationLabel}>
                      {t(notificationTypeLabelKey(category.id), category.id)}
                    </span>
                    <span className={styles.notificationDescription}>
                      {t(notificationTypeDescriptionKey(category.id), "")}
                    </span>
                  </span>
                </label>
                <div className={styles.notificationSubList}>
                  {category.subcategories.map((leaf) => (
                    <label key={leaf} className={styles.notificationSubItem}>
                      <Checkbox
                        checked={selectedLeaves.has(leaf as TelegramNotificationLeaf)}
                        disabled={!isActive}
                        onCheckedChange={(value) =>
                          toggleLeaf(leaf as TelegramNotificationLeaf, value === true)
                        }
                      />
                      <span className={styles.notificationSubLabel}>
                        {t(subcategoryLabelKey(leaf), leaf)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.modalActions}>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? t("common.saving", "Saving…") : t("common.save", "Save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
