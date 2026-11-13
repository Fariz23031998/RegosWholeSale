import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import { useLanguage } from "@/contexts/LanguageContext";
import { getPartnerNotificationVariableGroups } from "@/lib/partner-notification-template-variables";
import type { PartnerNotificationTemplateType } from "@/lib/partner-telegram-api";
import styles from "./PartnerTelegram.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  templateType: PartnerNotificationTemplateType;
};

export function PartnerNotificationTemplateVariablesModal({
  open,
  onClose,
  templateType,
}: Props) {
  const { t } = useLanguage();
  const groups = getPartnerNotificationVariableGroups(templateType);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t("partnerTelegram.templateVariablesTitle", "Template variables")}
    >
      <div className={styles.variableModalBody}>
        <p className={styles.variableIntro}>
          {t(
            "partnerTelegram.templateVariablesIntro",
            "Use {{placeholders}} in the template text. Messages support Telegram HTML tags such as <b>, <i>, and <code>. Leave a language blank to use the built-in message.",
          )}
        </p>

        <div className={styles.variablePanel}>
          {groups.map((group) => (
            <div key={group.id} className={styles.variableGroup}>
              <div className={styles.variableGroupTitle}>
                {t(group.labelKey, group.labelFallback)}
              </div>
              <div className={styles.variableList}>
                {group.variables.map((variable) => (
                  <div key={variable.expression} className={styles.variableItem}>
                    <code className={styles.variableChip}>{variable.expression}</code>
                    <span className={styles.variableDesc}>
                      {t(
                        `partnerTelegram.var.${variable.key}`,
                        variable.descriptionFallback,
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className={styles.variableModalActions}>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.close", "Close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
