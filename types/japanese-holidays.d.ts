declare module "japanese-holidays" {
  export function getHolidaysOf(
    year: number,
    furikae?: boolean,
  ): Array<{
    month: number; // 1-12
    date: number; // 1-31
    name: string;
  }>;
  export function isHoliday(date: Date, furikae?: boolean): string | undefined;
}
