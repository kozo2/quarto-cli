#!/bin/bash

# Prepares Quarto source files for packaging
source ../../configuration

# TODO: Consider generating a source map or something to get a good stack
# Create the Deno bundle
../$QUARTO_DIST_DIR/$QUARTO_BIN_DIR/deno run --unstable --allow-env --allow-read --allow-write --allow-run common/prepare-dist.ts

