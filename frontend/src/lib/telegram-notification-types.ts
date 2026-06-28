export const TELEGRAM_NOTIFICATION_CATEGORIES = [
  {
    id: "purchase",
    subcategories: ["purchase_performed", "purchase_cancelled"],
  },
  {
    id: "return_purchase",
    subcategories: ["return_purchase_performed", "return_purchase_cancelled"],
  },
  {
    id: "wholesale",
    subcategories: ["wholesale_performed", "wholesale_cancelled"],
  },
  {
    id: "wholesale_return",
    subcategories: ["wholesale_return_performed", "wholesale_return_cancelled"],
  },
  {
    id: "payment",
    subcategories: ["payment_performed", "payment_cancelled"],
  },
  {
    id: "inout",
    subcategories: ["inout_performed", "inout_cancelled"],
  },
  {
    id: "movement",
    subcategories: ["movement_performed", "movement_cancelled"],
  },
  {
    id: "out_of_stock",
    subcategories: ["out_of_stock"],
  },
  {
    id: "pos_cheque",
    subcategories: ["pos_cheque_closed", "pos_cheque_cancelled", "pos_cheque_return"],
  },
  {
    id: "pos_session",
    subcategories: ["pos_session_opened", "pos_session_closed"],
  },
] as const;

export type TelegramNotificationCategoryId =
  (typeof TELEGRAM_NOTIFICATION_CATEGORIES)[number]["id"];

export type TelegramNotificationLeaf =
  (typeof TELEGRAM_NOTIFICATION_CATEGORIES)[number]["subcategories"][number];

export const ALL_LEAF_NOTIFICATION_TYPES: TelegramNotificationLeaf[] =
  TELEGRAM_NOTIFICATION_CATEGORIES.flatMap((category) => [
    ...category.subcategories,
  ]) as TelegramNotificationLeaf[];

/** @deprecated Use ALL_LEAF_NOTIFICATION_TYPES */
export const TELEGRAM_NOTIFICATION_TYPES = ALL_LEAF_NOTIFICATION_TYPES;

export type TelegramNotificationType = TelegramNotificationLeaf;

const LEGACY_PARENT_SET = new Set(
  TELEGRAM_NOTIFICATION_CATEGORIES.map((category) => category.id),
);

const LEAF_TYPE_SET = new Set<string>(ALL_LEAF_NOTIFICATION_TYPES);

const LEGACY_TO_LEAVES = Object.fromEntries(
  TELEGRAM_NOTIFICATION_CATEGORIES.map((category) => [
    category.id,
    category.subcategories,
  ]),
) as Record<string, readonly string[]>;

export function notificationTypeLabelKey(categoryId: string): string {
  return `telegramUsers.notificationTypes.${categoryId}`;
}

export function notificationTypeDescriptionKey(categoryId: string): string {
  return `telegramUsers.notificationTypes.${categoryId}Description`;
}

export function subcategoryLabelKey(leafId: string): string {
  return `telegramUsers.notificationSubcategories.${leafId}`;
}

export function expandLegacyNotificationTypes(types: string[]): TelegramNotificationLeaf[] {
  const expanded = new Set<TelegramNotificationLeaf>();

  for (const item of types) {
    if (LEAF_TYPE_SET.has(item)) {
      expanded.add(item as TelegramNotificationLeaf);
    } else if (LEGACY_PARENT_SET.has(item)) {
      for (const leaf of LEGACY_TO_LEAVES[item]) {
        expanded.add(leaf as TelegramNotificationLeaf);
      }
    }
  }

  return ALL_LEAF_NOTIFICATION_TYPES.filter((leaf) => expanded.has(leaf));
}

export function countEnabledLeafTypes(types: string[]): number {
  return expandLegacyNotificationTypes(types).length;
}

export function categorySelectionState(
  selectedLeaves: Set<string>,
  subcategories: readonly string[],
): boolean | "indeterminate" {
  const selectedCount = subcategories.filter((leaf) => selectedLeaves.has(leaf)).length;
  if (selectedCount === 0) return false;
  if (selectedCount === subcategories.length) return true;
  return "indeterminate";
}

export function isSingleLeafCategory(subcategories: readonly string[]): boolean {
  return subcategories.length === 1;
}
