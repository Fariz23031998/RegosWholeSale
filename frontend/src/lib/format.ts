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

const pad2 = (value: number) => String(value).padStart(2, "0");

const formatDateParts = (date: Date) => ({
  day: pad2(date.getDate()),
  month: pad2(date.getMonth() + 1),
  year: date.getFullYear(),
  hours: pad2(date.getHours()),
  minutes: pad2(date.getMinutes()),
});

export const formatDateTime = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const { day, month, year, hours, minutes } = formatDateParts(date);
  return `${day}.${month}.${year} ${hours}:${minutes}`;
};

export const formatDate = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const { day, month, year } = formatDateParts(date);
  return `${day}.${month}.${year}`;
};
