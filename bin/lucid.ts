#!/usr/bin/env bun

/**
 * Lucid CLI entry point.
 */

import { createProgram } from '../src/cli';

const program = createProgram();
program.parse();
