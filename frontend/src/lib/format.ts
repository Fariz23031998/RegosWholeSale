export const formatCurrency = (n: number): string => {
  const rounded = Math.round(n * 100) / 100;
  const absFixed = Math.abs(rounded).toFixed(2);
  const [intPart, decPart] = absFixed.split(".");
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const sign = rounded < 0 ? "-" : "";

  if (decPart === "00") {
    return `${sign}${formattedInt}`;
  }

  return `${sign}${formattedInt}.${decPart}`;
};

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
