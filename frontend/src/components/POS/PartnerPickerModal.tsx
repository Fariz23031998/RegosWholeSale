import clsx from "clsx";
import { ArrowLeft, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/posui/Modal";
import { Button } from "@/components/posui/Button";
import { formatAuthError } from "@/store/auth";
import {
  createPartner,
  deleteMarkPartner,
  fetchPartnerGroups,
  fetchPartners,
  updatePartner,
} from "@/lib/partners-api";
import type { Partner, PartnerFormValues, PartnerGroup } from "@/types/partners";
import {
  EMPTY_PARTNER_FORM,
  formValuesToCreateRequest,
  formValuesToUpdateRequest,
  partnerToFormValues,
} from "@/types/partners";
import styles from "./POS.module.css";

type View = "list" | "form";

type Props = {
  open: boolean;
  onClose: () => void;
  token: string;
  selectedPartnerId: number | null;
  onSelect: (partner: Partner) => void;
  onPartnersChanged: () => Promise<void>;
};

export function PartnerPickerModal({
  open,
  onClose,
  token,
  selectedPartnerId,
  onSelect,
  onPartnersChanged,
}: Props) {
  const [view, setView] = useState<View>("list");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [partners, setPartners] = useState<Partner[]>([]);
  const [groups, setGroups] = useState<PartnerGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingPartner, setEditingPartner] = useState<Partner | null>(null);
  const [form, setForm] = useState<PartnerFormValues>(EMPTY_PARTNER_FORM);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [open, search]);

  const resetListState = useCallback(() => {
    setView("list");
    setSearch("");
    setDebouncedSearch("");
    setEditingPartner(null);
    setForm(EMPTY_PARTNER_FORM);
    setError("");
  }, []);

  useEffect(() => {
    if (!open) {
      resetListState();
      return;
    }
    resetListState();
  }, [open, resetListState]);

  const loadPartners = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetchPartners(token, {
        search: debouncedSearch || undefined,
        limit: 100,
      });
      setPartners(response.partners);
    } catch (err) {
      setError(formatAuthError(err, "Failed to load partners."));
      setPartners([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, token]);

  useEffect(() => {
    if (!open || view !== "list") return;
    void loadPartners();
  }, [loadPartners, open, view]);

  const loadGroups = useCallback(async () => {
    try {
      const response = await fetchPartnerGroups(token);
      setGroups(response.groups);
      return response.groups;
    } catch (err) {
      setError(formatAuthError(err, "Failed to load partner groups."));
      setGroups([]);
      return [];
    }
  }, [token]);

  const openCreateForm = async () => {
    setError("");
    const loadedGroups = groups.length ? groups : await loadGroups();
    setEditingPartner(null);
    setForm({
      ...EMPTY_PARTNER_FORM,
      group_id: loadedGroups[0] ? String(loadedGroups[0].id) : "",
    });
    setView("form");
  };

  const openEditForm = async (partner: Partner) => {
    setError("");
    if (!groups.length) {
      await loadGroups();
    }
    setEditingPartner(partner);
    setForm(partnerToFormValues(partner));
    setView("form");
  };

  const handleSelect = (partner: Partner) => {
    onSelect(partner);
    onClose();
  };

  const handleFormChange = (
    field: keyof PartnerFormValues,
    value: string | PartnerFormValues["legal_status"],
  ) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");

    if (!form.name.trim()) {
      setError("Partner name is required.");
      return;
    }
    if (!form.group_id) {
      setError("Partner group is required.");
      return;
    }

    setSaving(true);
    try {
      if (editingPartner) {
        await updatePartner(token, editingPartner.id, formValuesToUpdateRequest(form));
        await onPartnersChanged();
        await loadPartners();
        setView("list");
        setEditingPartner(null);
        setForm(EMPTY_PARTNER_FORM);
      } else {
        const created = await createPartner(token, formValuesToCreateRequest(form));
        await onPartnersChanged();
        const createdPartner: Partner = {
          id: created.id,
          name: form.name.trim(),
          fullname: form.fullname.trim() || null,
          legal_status: form.legal_status,
          group_id: Number(form.group_id),
          group_name: groups.find((group) => group.id === Number(form.group_id))?.name ?? null,
          boss_name: form.boss_name.trim() || null,
          address: form.address.trim() || null,
          phones: form.phones.trim() || null,
          email: form.email.trim() || null,
          description: form.description.trim() || null,
          inn: form.inn.trim() || null,
          bank_name: form.bank_name.trim() || null,
          mfo: form.mfo.trim() || null,
          rs: form.rs.trim() || null,
          oked: form.oked.trim() || null,
          vat_index: form.vat_index.trim() || null,
          deleted_mark: false,
        };
        onSelect(createdPartner);
        onClose();
      }
    } catch (err) {
      setError(formatAuthError(err, "Failed to save partner."));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingPartner) return;
    const confirmed = window.confirm(
      `Mark "${editingPartner.name}" for deletion?`,
    );
    if (!confirmed) return;

    setSaving(true);
    setError("");
    try {
      await deleteMarkPartner(token, editingPartner.id);
      await onPartnersChanged();
      await loadPartners();
      setView("list");
      setEditingPartner(null);
      setForm(EMPTY_PARTNER_FORM);
    } catch (err) {
      setError(formatAuthError(err, "Failed to delete partner."));
    } finally {
      setSaving(false);
    }
  };

  const title = useMemo(() => {
    if (view === "form") {
      return editingPartner ? "Edit partner" : "New partner";
    }
    return "Select partner";
  }, [editingPartner, view]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      bodyClassName={styles.partnerModalBody}
    >
      {view === "list" ? (
        <>
          <div className={styles.partnerModalToolbar}>
            <div className={styles.categoryModalSearch}>
              <Search size={16} className={styles.searchIcon} />
              <input
                className={styles.searchInput}
                type="search"
                placeholder="Search partners..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search partners"
              />
            </div>
            <Button type="button" size="sm" onClick={() => void openCreateForm()}>
              <Plus size={14} />
              Add
            </Button>
          </div>

          {error ? <div className={styles.partnerModalError}>{error}</div> : null}

          <div className={styles.partnerModalList} role="listbox" aria-label="Partners">
            {loading ? (
              <div className={styles.categoryModalEmpty}>Loading partners...</div>
            ) : partners.length === 0 ? (
              <div className={styles.categoryModalEmpty}>No partners match your search.</div>
            ) : (
              partners.map((partner) => {
                const isActive = selectedPartnerId === partner.id;
                return (
                  <div
                    key={partner.id}
                    className={clsx(
                      styles.partnerModalItem,
                      isActive && styles.partnerModalItemActive,
                    )}
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      className={styles.partnerModalItemMain}
                      onClick={() => handleSelect(partner)}
                    >
                      <span className={styles.partnerModalItemName}>{partner.name}</span>
                      {partner.phones || partner.inn ? (
                        <span className={styles.partnerModalItemMeta}>
                          {[partner.phones, partner.inn].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className={styles.partnerModalItemAction}
                      aria-label={`Edit ${partner.name}`}
                      onClick={() => void openEditForm(partner)}
                    >
                      <Pencil size={14} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : (
        <form className={styles.partnerForm} onSubmit={(event) => void handleSave(event)}>
          <button
            type="button"
            className={styles.partnerFormBack}
            onClick={() => {
              setView("list");
              setEditingPartner(null);
              setForm(EMPTY_PARTNER_FORM);
              setError("");
            }}
          >
            <ArrowLeft size={14} />
            Back to list
          </button>

          {error ? <div className={styles.partnerModalError}>{error}</div> : null}

          <div className={styles.partnerFormGrid}>
            <label className={styles.partnerFormField}>
              <span>Name *</span>
              <input
                value={form.name}
                onChange={(event) => handleFormChange("name", event.target.value)}
                required
              />
            </label>

            <label className={styles.partnerFormField}>
              <span>Group *</span>
              <select
                value={form.group_id}
                onChange={(event) => handleFormChange("group_id", event.target.value)}
                required
              >
                <option value="" disabled>
                  Select group
                </option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.partnerFormField}>
              <span>Legal status *</span>
              <select
                value={form.legal_status}
                onChange={(event) =>
                  handleFormChange("legal_status", event.target.value as PartnerFormValues["legal_status"])
                }
              >
                <option value="Natural">Individual</option>
                <option value="Legal">Legal entity</option>
              </select>
            </label>

            <label className={styles.partnerFormField}>
              <span>Full name</span>
              <input
                value={form.fullname}
                onChange={(event) => handleFormChange("fullname", event.target.value)}
              />
            </label>

            <label className={styles.partnerFormField}>
              <span>Phones</span>
              <input
                value={form.phones}
                onChange={(event) => handleFormChange("phones", event.target.value)}
              />
            </label>

            <label className={styles.partnerFormField}>
              <span>Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => handleFormChange("email", event.target.value)}
              />
            </label>

            <label className={clsx(styles.partnerFormField, styles.partnerFormFieldWide)}>
              <span>Address</span>
              <input
                value={form.address}
                onChange={(event) => handleFormChange("address", event.target.value)}
              />
            </label>

            <label className={styles.partnerFormField}>
              <span>INN</span>
              <input
                value={form.inn}
                onChange={(event) => handleFormChange("inn", event.target.value)}
              />
            </label>

            <label className={styles.partnerFormField}>
              <span>Boss name</span>
              <input
                value={form.boss_name}
                onChange={(event) => handleFormChange("boss_name", event.target.value)}
              />
            </label>

            <label className={styles.partnerFormField}>
              <span>Bank</span>
              <input
                value={form.bank_name}
                onChange={(event) => handleFormChange("bank_name", event.target.value)}
              />
            </label>

            <label className={styles.partnerFormField}>
              <span>MFO</span>
              <input
                value={form.mfo}
                onChange={(event) => handleFormChange("mfo", event.target.value)}
              />
            </label>

            <label className={styles.partnerFormField}>
              <span>Account</span>
              <input
                value={form.rs}
                onChange={(event) => handleFormChange("rs", event.target.value)}
              />
            </label>

            <label className={styles.partnerFormField}>
              <span>OKED</span>
              <input
                value={form.oked}
                onChange={(event) => handleFormChange("oked", event.target.value)}
              />
            </label>

            <label className={styles.partnerFormField}>
              <span>VAT index</span>
              <input
                value={form.vat_index}
                onChange={(event) => handleFormChange("vat_index", event.target.value)}
              />
            </label>

            <label className={clsx(styles.partnerFormField, styles.partnerFormFieldWide)}>
              <span>Description</span>
              <textarea
                rows={3}
                value={form.description}
                onChange={(event) => handleFormChange("description", event.target.value)}
              />
            </label>
          </div>

          <div className={styles.partnerFormActions}>
            {editingPartner ? (
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={saving}
                onClick={() => void handleDelete()}
              >
                <Trash2 size={14} />
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className={styles.partnerFormActionsRight}>
              <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? "Saving..." : editingPartner ? "Save changes" : "Create partner"}
              </Button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}
