export const startOfDay = (date = new Date()) => {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
};

export const endOfDay = (date = new Date()) => {
  const value = startOfDay(date);
  value.setHours(23, 59, 59, 999);
  return value;
};

export const startOfWeek = (date = new Date()) => {
  const value = startOfDay(date);
  const day = value.getDay();
  const offset = day === 0 ? 6 : day - 1;
  value.setDate(value.getDate() - offset);
  return value;
};
