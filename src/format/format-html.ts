/*
* format-html.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import { existsSync } from "fs/mod.ts";
import { join } from "path/mod.ts";
import { ld } from "lodash/mod.ts";

import { Document, Element } from "deno_dom/deno-dom-wasm.ts";

import { renderEjs } from "../core/ejs.ts";
import { mergeConfigs } from "../core/config.ts";
import { formatResourcePath } from "../core/resources.ts";
import { sessionTempFile } from "../core/temp.ts";
import { compileScss } from "../core/dart-sass.ts";

import {
  kFilters,
  kHeaderIncludes,
  kHtmlMathMethod,
  kSectionDivs,
  kTableOfContents,
  kToc,
  kTocTitle,
  kVariables,
} from "../config/constants.ts";
import {
  Format,
  FormatExtras,
  kBodyEnvelope,
  kDependencies,
  kHtmlPostprocessors,
} from "../config/format.ts";
import { PandocFlags } from "../config/flags.ts";
import { Metadata } from "../config/metadata.ts";
import { baseHtmlFormat } from "./formats.ts";

export const kTheme = "theme";
export const kTocFloat = "toc-float";
export const kPageLayout = "page-layout";
export const kDocumentCss = "document-css";

export function htmlFormat(
  figwidth: number,
  figheight: number,
): Format {
  return mergeConfigs(
    baseHtmlFormat(figwidth, figheight),
    {
      metadata: {
        [kTheme]: "default",
      },
      pandoc: {
        [kHtmlMathMethod]: "mathjax",
      },
    },
    {
      formatExtras: (flags: PandocFlags, format: Format) => {
        if (format.metadata[kTheme]) {
          const theme = String(format.metadata[kTheme]);

          // 'pandoc' theme means include default pandoc document css
          if (theme === "pandoc") {
            return Promise.resolve(pandocExtras(format.metadata));

            // other themes are bootswatch themes or bootstrap css files
          } else {
            return boostrapExtras(flags, format);
          }

          // theme: null means no default document css at all
        } else {
          return Promise.resolve({
            pandoc: {
              [kVariables]: {
                [kDocumentCss]: false,
              },
            },
          });
        }
      },
    },
  );
}

export function formatHasBootstrap(format: Format) {
  const theme = format.metadata["theme"];
  return theme && theme !== "pandoc";
}

export function hasTableOfContents(flags: PandocFlags, format: Format) {
  return !!((flags[kToc] || format.pandoc[kToc] ||
    format.pandoc[kTableOfContents]) && (format.metadata[kTocFloat] !== false));
}

export function hasTableOfContentsTitle(flags: PandocFlags, format: Format) {
  return flags[kTocTitle] !== undefined ||
    format.metadata[kTocTitle] !== undefined;
}

export async function bootstrapFormatDependency(format: Format) {
  // determine theme
  const theme = format.metadata[kTheme]
    ? String(format.metadata[kTheme])
    : "default";

  // read options from yaml
  const metadata = format.metadata;
  const options: Record<string, string | undefined> = {
    maxwidth: maxWidthCss(metadata["max-width"]),
    margintop: asCssSizeAttrib("margin-top", metadata["margin-top"]),
    marginbottom: asCssSizeAttrib("margin-bottom", metadata["margin-bottom"]),
    marginleft: asCssSizeAttrib("margin-left", metadata["margin-left"]),
    marginright: asCssSizeAttrib("margin-right", metadata["margin-right"]),
    mainfont: asFontFamily(metadata["mainfont"]),
    fontsize: asCssSizeAttrib("font-size", metadata["fontsize"]),
    fontcolor: asCssAttrib("color", metadata["fontcolor"]),
    linkcolor: asCssAttrib("color", metadata["linkcolor"]),
    monofont: asFontFamily(metadata["monofont"]),
    monobackgroundcolor: asCssAttrib(
      "background-color",
      metadata["monobackgroundcolor"],
    ),
    linestretch: asCssAttrib("line-height", metadata["linestretch"]),
    backgroundcolor: asCssAttrib(
      "background-color",
      metadata["backgroundcolor"],
    ),
  };

  // Compile the scss
  const bootstrapCss = await compileBootstrapScss(theme);

  const boostrapResource = (resource: string) =>
    formatResourcePath(
      "html",
      `bootstrap/themes/default/${resource}`,
    );
  const bootstrapDependency = (resource: string) => ({
    name: resource,
    path: boostrapResource(resource),
  });
  const quartoDependency = (resource: string) => ({
    name: resource,
    path: formatResourcePath("html", resource),
  });

  // process the quarto in header template
  const templateSrc = Deno.readTextFileSync(
    formatResourcePath("html", "quarto-bootstrap.css"),
  );
  const template = ld.template(templateSrc, {}, undefined);

  const quartoCss = sessionTempFile();
  Deno.writeTextFileSync(
    quartoCss,
    template(templateOptions(options)),
  );

  return {
    name: "bootstrap",
    version: "v5.0.0-beta2",
    stylesheets: [
      { name: "bootstrap.min.css", path: bootstrapCss },
      bootstrapDependency("bootstrap-icons.css"),
      { name: "quarto-bootstrap.css", path: quartoCss },
    ],
    scripts: [
      bootstrapDependency("bootstrap.bundle.min.js"),
    ],
    resources: [
      bootstrapDependency("bootstrap-icons.woff"),
    ],
  };
}

const kbootStrapScss = "_bootstrap.scss";
const kVariablesScss = "_variables.scss";

function resolveTheme(
  theme: string,
  quartoThemesDir: string,
): { variables?: string; bootstrap?: string } {
  const resolvedThemeDir = join(quartoThemesDir, theme);
  if (existsSync(resolvedThemeDir)) {
    // It's a built in theme, just return the files r
    return {
      variables: join(resolvedThemeDir, kVariablesScss),
      bootstrap: join(resolvedThemeDir, "_bootswatch.scss"),
    };
  } else if (existsSync(theme) && Deno.statSync(theme).isDirectory) {
    // It is not a built in theme, assume its a path and use that
    const variables = join(theme, kVariablesScss);
    const styles = join(theme, kbootStrapScss);
    return {
      variables: existsSync(variables) ? variables : undefined,
      bootstrap: existsSync(styles) ? styles : undefined,
    };
  } else {
    // Who know what this is
    return {};
  }
}

async function compileBootstrapScss(theme: string) {
  // Quarto built in css
  const quartoThemesDir = formatResourcePath("html", `bootstrap/themes`);
  const bootstrapCore = join(
    quartoThemesDir,
    "default/scss/bootstrap.scss",
  );
  const quartoVariables = formatResourcePath(
    "html",
    "_quarto-variables.scss",
  );
  const quartoBootstrap = formatResourcePath("html", "_quarto.scss");

  // Resolve the provided theme (either to a built in theme or a custom
  // theme directory)
  const resolvedTheme = resolveTheme(theme, quartoThemesDir);
  if (!resolvedTheme.variables && resolvedTheme.bootstrap) {
    throw new Error(`Theme ${theme} does not contain any valid scss files`);
  }

  // Generate the list of scss files
  const scssPaths: string[] = [];
  if (resolvedTheme.variables) {
    scssPaths.push(resolvedTheme.variables);
  }
  scssPaths.push(quartoVariables);
  scssPaths.push(bootstrapCore);
  if (resolvedTheme.bootstrap) {
    scssPaths.push(resolvedTheme.bootstrap);
  }
  scssPaths.push(quartoBootstrap);

  // Read the scss files into a single input string
  const scssInput = scssPaths.map((importPath) =>
    Deno.readTextFileSync(importPath)
  ).join("\n\n");

  // Compile the scss
  return await compileScss(
    scssInput,
    [
      join(quartoThemesDir, "default/scss/"),
    ],
    true,
    theme,
  );
}

function pandocExtras(metadata: Metadata) {
  // see if there is a max-width
  const maxWidth = metadata["max-width"];
  const headerIncludes = maxWidth
    ? `<style type="text/css">body { max-width: ${
      asCssSize(maxWidth)
    };}</style>`
    : undefined;

  return {
    pandoc: {
      [kVariables]: {
        [kDocumentCss]: true,
        [kHeaderIncludes]: headerIncludes,
      },
    },
  };
}

async function boostrapExtras(
  flags: PandocFlags,
  format: Format,
): Promise<FormatExtras> {
  const toc = hasTableOfContents(flags, format);

  const renderTemplate = (template: string) => {
    return renderEjs(formatResourcePath("html", `templates/${template}`), {
      toc,
    });
  };

  const bodyEnvelope = format.metadata[kPageLayout] !== "none"
    ? {
      before: renderTemplate("before-body.ejs"),
      after: renderTemplate("after-body.ejs"),
    }
    : undefined;

  return {
    pandoc: {
      [kSectionDivs]: true,
      [kVariables]: {
        [kDocumentCss]: false,
      },
    },
    [kTocTitle]: !hasTableOfContentsTitle(flags, format)
      ? "Table of contents"
      : undefined,
    [kDependencies]: [await bootstrapFormatDependency(format)],
    [kBodyEnvelope]: bodyEnvelope,
    [kFilters]: {
      pre: [
        formatResourcePath("html", "html.lua"),
      ],
    },
    [kHtmlPostprocessors]: [bootstrapHtmlPostprocessor],
  };
}

function bootstrapHtmlPostprocessor(doc: Document) {
  // use display-6 style for title
  const title = doc.querySelector("header > .title");
  if (title) {
    title.classList.add("display-6");
  }

  // add 'lead' to subtitle
  const subtitle = doc.querySelector("header > .subtitle");
  if (subtitle) {
    subtitle.classList.add("lead");
  }

  // move the toc if there is a sidebar
  const toc = doc.querySelector('nav[role="doc-toc"]');
  const tocSidebar = doc.getElementById("quarto-toc-sidebar");
  if (toc && tocSidebar) {
    tocSidebar.appendChild(toc);
    // add scroll spy to the body
    const body = doc.body;
    body.setAttribute("data-bs-spy", "scroll");
    body.setAttribute("data-bs-target", "#" + tocSidebar.id);

    // add nav-link class to the TOC links
    const tocLinks = doc.querySelectorAll('nav[role="doc-toc"] a');
    for (let i = 0; i < tocLinks.length; i++) {
      // Mark the toc links as nav-links
      const tocLink = tocLinks[i] as Element;
      tocLink.classList.add("nav-link");

      // move the raw href to the target attribute (need the raw value, not the full path)
      if (!tocLink.hasAttribute("data-bs-target")) {
        tocLink.setAttribute("data-bs-target", tocLink.getAttribute("href"));
      }
    }
  }

  // add .table class to pandoc tables
  var tableHeaders = doc.querySelectorAll("tr.header");
  for (let i = 0; i < tableHeaders.length; i++) {
    const th = tableHeaders[i];
    if (th.parentNode?.parentNode) {
      (th.parentNode.parentNode as Element).classList.add("table");
    }
  }
}

function templateOptions(
  options: Record<string, string | undefined>,
) {
  // provide empty string for undefined keys
  const opts = ld.cloneDeep(options);
  for (const key of Object.keys(opts)) {
    opts[key] = opts[key] || "";
  }

  // if we have a monobackground color then add padding, otherise
  // provide a default code block border treatment
  opts.monoBackground = opts.monobackgroundcolor
    ? opts.monobackgroundcolor + "  padding: 0.2em;\n"
    : undefined;
  opts.codeblockBorder = opts.monoBackground
    ? undefined
    : "  padding-left: 0.6rem;\n  border-left: 3px solid;\n";

  // return options
  return opts;
}

function maxWidthCss(value: unknown) {
  const maxWidth = asCssSize(value) || "1400px";
  return `#quarto-content {
  max-width: ${maxWidth};
}`;
}

function asFontFamily(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  } else {
    const fontFamily = String(value)
      .split(",")
      .map((font) => {
        font = font.trim();
        if (font.includes(" ")) {
          font = `"${font}"`;
        }
        return font;
      })
      .filter((font) => font.length > 0)
      .join(", ");
    return `  font-family: ${fontFamily};\n`;
  }
}

function asCssAttrib(attrib: string, value: unknown): string | undefined {
  if (!value) {
    return undefined;
  } else {
    return `  ${attrib}: ${String(value)};\n`;
  }
}

function asCssSizeAttrib(attrib: string, value: unknown): string | undefined {
  const size = asCssSize(value);
  return asCssAttrib(attrib, size);
}

function asCssSize(value: unknown): string | undefined {
  if (typeof (value) === "number") {
    if (value === 0) {
      return "0";
    } else {
      return value + "px";
    }
  } else if (!value) {
    return undefined;
  } else {
    const str = String(value);
    if (str !== "0" && !str.match(/\w$/)) {
      return str + "px";
    } else {
      return str;
    }
  }
}
