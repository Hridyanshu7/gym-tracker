export function previousDate(date) {
  const value=new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate()-1);
  return value.toISOString().slice(0,10);
}

export const isLockedDate = (date,today) => date < previousDate(today);
export const isCorrectionDate = (date,today) => date === previousDate(today);
