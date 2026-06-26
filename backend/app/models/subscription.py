import enum


class SubscriptionStatus(str, enum.Enum):
    trial = "trial"
    active = "active"
    expired = "expired"
    suspended = "suspended"
