/*
* date.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/
import momentGuess from "moment-guess";

import { parse } from "datetime/mod.ts";
import dayjs from "dayjs/dayjs.min.js";
import { existsSync } from "fs/mod.ts";

import { toFileUrl } from "path/mod.ts";
import { resourcePath } from "./resources.ts";

// Special date constants
export const kLastModified = "last-modified";
export const kToday = "today";
export const rSysDate = "`r Sys.time()`";
export const kNow = "now";

export type DateFormat = "full" | "long" | "medium" | "short" | string;
export type TimeFormat = "full" | "long" | "medium" | "short";

export function today(): Date {
  const today = new Date();
  today.setHours(0);
  today.setMinutes(0);
  today.setSeconds(0);
  today.setMilliseconds(0);
  return today;
}

export function resolveDate(input: string | string[], val: unknown) {
  if (isSpecialDate(val)) {
    return parseSpecialDate(input, val);
  } else {
    return val;
  }
}

export function isSpecialDate(val?: unknown) {
  return val === kLastModified || val === kToday || val === rSysDate ||
    val === kNow;
}

export function parseSpecialDate(input: string | string[], val: unknown) {
  if (val === kLastModified || val === rSysDate) {
    if (!Array.isArray(input)) {
      input = [input];
    }

    let lastModifiedTs = 0;
    for (const inp of input) {
      const stat = Deno.statSync(inp);
      if (stat.mtime) {
        lastModifiedTs = Math.max(lastModifiedTs, stat.mtime.getTime());
      }
    }

    // Format as an ISO timestamp
    return formatDate(new Date(lastModifiedTs), "YYYY-MM-DDTHH:mm:ssZ");
  } else if (val === kToday) {
    return formatDate(today(), "YYYY-MM-DDTHH:mm:ssZ");
  } else if (val === kNow) {
    return formatDate(new Date(), "YYYY-MM-DDTHH:mm:ssZ");
  } else {
    return val;
  }
}

export async function setDateLocale(locale: string) {
  if (locale !== dayjs.locale()) {
    const localePath = resourcePath(`library/dayjs/locale/${locale}.js`);
    if (existsSync(localePath)) {
      const localeUrl = toFileUrl(localePath).href;
      const localeModule = await import(localeUrl);
      dayjs.locale(localeModule.default, null, true);
      dayjs.locale(locale);
    }
  }
}

// Formats a date for a locale using either the shorthand form ("full")
// or a format string ("d-M-yyyy")
export const formatDate = (
  date: Date,
  dateStyle: DateFormat,
  timeStyle?: TimeFormat,
) => {
  if (
    dateStyle === "full" || dateStyle === "long" || dateStyle === "medium" ||
    dateStyle === "short"
  ) {
    const options: Intl.DateTimeFormatOptions = {
      dateStyle,
    };
    if (timeStyle) {
      options.timeStyle = timeStyle;
    }
    return date.toLocaleString(dayjs.locale(), options);
  } else {
    return dayjs(date).format(dateStyle);
  }
};

export const formattedDate = (
  dateStr: string,
  dateFormat: string,
) => {
  const date = parsePandocDate(dateStr);

  if (date) {
    const formatted = formatDate(
      date,
      dateFormat,
    );
    return formatted;
  } else {
    return undefined;
  }
};

export const parsePandocDate = (dateRaw: string) => {
  const formats = [
    "MM/dd/yyyy",
    "MM-dd-yyyy",
    "MM/dd/yy",
    "MM-dd-yy",
    "yyyy-MM-dd",
    "dd MM yyyy",
    "MM dd, yyyy",
  ];
  const parseFormat = (dateStr: string) => {
    for (const format of formats) {
      try {
        const date = parse(dateStr, format);
        return date;
      } catch {
        // This date wouldn't parse, try other formats
      }
    }

    // Try to guess the format
    try {
      const formats = momentGuess(dateRaw);
      if (formats) {
        try {
          // momentGuess could return more than one format if the date is
          // ambiguous. If so, just take the first format
          const format = Array.isArray(formats) ? formats[0] : formats;
          const date = dayjs(dateStr, format);
          return date.local();
        } catch {
          // Couldn't parse, keep going
        }
      }
    } catch {
      // Couldn't parse, keep going
    }

    // Try ISO date parse
    try {
      return new Date(dateStr);
    } catch {
      return undefined;
    }
  };
  // Trying parsing format strings
  return parseFormat(dateRaw);
};
