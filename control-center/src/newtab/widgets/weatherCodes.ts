/** WMO weather codes (Open-Meteo) → icon + label. */
const TABLE: [number[], string, string, string][] = [
  [[0], '☀️', 'Clear sky', 'Açık'],
  [[1], '🌤️', 'Mainly clear', 'Az bulutlu'],
  [[2], '⛅', 'Partly cloudy', 'Parçalı bulutlu'],
  [[3], '☁️', 'Overcast', 'Kapalı'],
  [[45, 48], '🌫️', 'Fog', 'Sis'],
  [[51, 53, 55, 56, 57], '🌦️', 'Drizzle', 'Çisenti'],
  [[61, 63, 65, 66, 67, 80, 81, 82], '🌧️', 'Rain', 'Yağmur'],
  [[71, 73, 75, 77, 85, 86], '🌨️', 'Snow', 'Kar'],
  [[95, 96, 99], '⛈️', 'Thunderstorm', 'Gök gürültülü fırtına'],
];

export function describeWeather(code: number, locale: string, isDay = true): { icon: string; label: string } {
  const row = TABLE.find(([codes]) => codes.includes(code));
  if (!row) return { icon: '🌡️', label: '' };
  const icon = !isDay && code <= 1 ? '🌙' : row[1];
  return { icon, label: locale === 'tr' ? row[3] : row[2] };
}
