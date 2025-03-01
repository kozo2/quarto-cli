/*
* author.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

export interface Author {
  name: string;
  affilliation?: Affiliation;
  url?: string;
  orcid?: string;
}

export interface Affiliation {
  name: string;
  url?: string;
}

const kName = "name";
const kAffiliation = "affiliation";
const kAfilliationUrl = "affiliation-url";
const kOrcid = "orcid";
const kUrl = "url";

export function parseAuthor(authorRaw: unknown) {
  if (authorRaw) {
    const parsed: Author[] = [];
    const authors = Array.isArray(authorRaw) ? authorRaw : [authorRaw];
    authors.forEach((author) => {
      if (typeof (author) === "string") {
        // Its a string, so make it a name
        parsed.push({
          name: author,
        });
      } else if (typeof (author) === "object") {
        // Parse the author object
        // Currently this only supports simple 'Distill Style'
        // authors and affiliations
        const name = author[kName];
        if (name) {
          const auth: Author = {
            name,
          };
          const affilation = author[kAffiliation];
          if (affilation) {
            auth.affilliation = { name: affilation };
            if (author[kAfilliationUrl]) {
              auth.affilliation.url = author[kAfilliationUrl];
            }
          }

          const orcid = author[kOrcid];
          if (orcid) {
            auth.orcid = orcid;
          }

          const url = author[kUrl];
          if (url) {
            auth.url = url;
          }

          parsed.push(auth);
        }
      }
    });
    return parsed;
  } else {
    return undefined;
  }
}
