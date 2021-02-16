/*
* pandoc.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import { ld } from "lodash/mod.ts";

import { stringify } from "encoding/yaml.ts";

import { execProcess, ProcessResult } from "../../core/process.ts";
import { message } from "../../core/console.ts";

import { Format, FormatExtras, FormatPandoc } from "../../config/format.ts";
import { Metadata } from "../../config/metadata.ts";
import { binaryPath } from "../../core/resources.ts";

import { RenderFlags } from "./flags.ts";
import {
  generateDefaults,
  pandocDefaultsMessage,
  writeDefaultsFile,
} from "./defaults.ts";
import { removeFilterParmas, setFilterParams } from "./filters.ts";
import {
  kFilters,
  kIncludeAfterBody,
  kIncludeBeforeBody,
  kIncludeInHeader,
  kVariables,
} from "../../config/constants.ts";

// options required to run pandoc
export interface PandocOptions {
  // markdown input
  markdown: string;
  // working dir for conversion
  cwd: string;
  // target format
  format: Format;
  // command line args for pandoc
  args: string[];
  // command line flags (e.g. could be used
  // to specify e.g. quiet or pdf engine)
  flags?: RenderFlags;
}

export async function runPandoc(
  options: PandocOptions,
  sysFilters: string[],
): Promise<ProcessResult> {
  // build the pandoc command (we'll feed it the input on stdin)
  const cmd = [binaryPath("pandoc")];

  // build command line args
  const args = [...options.args];

  // provide default title if necessary
  if (!options.format.metadata["title"]) {
    args.push(
      "--metadata",
      "title:untitled",
    );
  }

  // propagate quiet
  if (options.flags?.quiet) {
    args.push("--quiet");
  }

  // save args and metadata so we can print them (we may subsequently edit them)
  const printArgs = [...args];
  const printMetadata = {
    ...ld.cloneDeep(options.format.metadata),
    ...options.flags?.metadata,
  };

  // don't print params metadata (that's for the computation engine not pandoc)
  delete printMetadata.params;

  // don't print project metadata
  delete printMetadata.project;

  // generate defaults and capture defaults to be printed
  let allDefaults = await generateDefaults(options) || {};
  const printAllDefaults = allDefaults ? ld.cloneDeep(allDefaults) : undefined;

  // see if there are extras
  if (sysFilters.length > 0 || options.format.preprocess) {
    const extras = options.format.preprocess
      ? (options.format.preprocess(options.format))
      : {};

    if (sysFilters.length > 0) {
      extras.filters = extras.filters || {};
      extras.filters.post = extras.filters.post || [];
      extras.filters.post.unshift(...sysFilters);
    }

    // merge the extras into the defaults
    if (extras[kVariables]) {
      allDefaults = { ...allDefaults, [kVariables]: extras[kVariables] };
    }
    if (extras[kIncludeInHeader]) {
      allDefaults = {
        ...allDefaults,
        [kIncludeInHeader]: [
          ...allDefaults[kIncludeInHeader] || [],
          ...extras[kIncludeInHeader] || [],
        ],
      };
    }
    if (extras[kIncludeBeforeBody]) {
      allDefaults = {
        ...allDefaults,
        [kIncludeBeforeBody]: [
          ...allDefaults[kIncludeBeforeBody] || [],
          ...extras[kIncludeBeforeBody] || [],
        ],
      };
    }
    if (extras[kIncludeAfterBody]) {
      allDefaults = {
        ...allDefaults,
        [kIncludeAfterBody]: [
          ...allDefaults[kIncludeAfterBody] || [],
          ...extras[kIncludeAfterBody] || [],
        ],
      };
    }

    // add any filters
    allDefaults.filters = [
      ...extras.filters?.pre || [],
      ...allDefaults.filters || [],
      ...extras.filters?.post || [],
    ];

    // make the filter paths windows safe
    allDefaults.filters = allDefaults.filters.map(pandocMetadataPath);
  }

  // set parameters required for filters (possibily mutating all of it's arguments
  // to pull includes out into quarto parameters so they can be merged)
  setFilterParams(args, options, allDefaults);

  // write the defaults file
  if (allDefaults) {
    const defaultsFile = await writeDefaultsFile(allDefaults);
    cmd.push("--defaults", defaultsFile);
  }

  // read the input file then append the metadata to the file (this is to that)
  // our fully resolved metadata, which incorporates project and format-specific
  // values, overrides the metadata contained within the file). we'll feed the
  // input to pandoc on stdin
  const input = options.markdown +
    "\n\n<!-- -->\n" +
    `\n---\n${stringify(options.format.metadata || {})}\n---\n`;

  // add user command line args
  cmd.push(...args);

  // print full resolved input to pandoc
  if (!options.flags?.quiet && options.format.metadata) {
    runPandocMessage(
      printArgs,
      printAllDefaults,
      sysFilters,
      printMetadata,
    );
  }

  // apply workaround for .output suppression
  // https://github.com/jgm/pandoc/issues/6841#issuecomment-728281039
  // NOTE: only required for pandoc < v2.11.2 so we can probably remove this
  cmd.push("--ipynb-output=all");

  // run pandoc
  return await execProcess(
    {
      cmd,
      cwd: options.cwd,
    },
    input,
  );
}

export function pandocMetadataPath(path: string) {
  return path.replace(/\\/g, "/");
}

function runPandocMessage(
  args: string[],
  pandoc: FormatPandoc | undefined,
  sysFilters: string[],
  metadata: Metadata,
  debug?: boolean,
) {
  message(`pandoc ${args.join(" ")}`, { bold: true });
  if (pandoc) {
    message(pandocDefaultsMessage(pandoc, sysFilters, debug), { indent: 2 });
  }

  if (Object.keys(metadata).length > 0) {
    message("metadata", { bold: true });
    const printMetadata = ld.cloneDeep(metadata) as Metadata;
    delete printMetadata.format;

    // remove filter params
    removeFilterParmas(printMetadata);

    // print message
    message(stringify(printMetadata), { indent: 2 });
  }
}
