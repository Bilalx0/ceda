import * as core from '@actions/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import type { LLMContext } from '../types/ceda.js';

const parser = new Parser();
const typescriptParser = TypeScript as unknown as Parser.Language;
parser.setLanguage(typescriptParser);

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function extractValidDependencies(projectRoot: string): Promise<string[]> {
  try {
    const packageJsonPath = path.join(projectRoot, 'package.json');
    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson: PackageJson = JSON.parse(packageJsonContent);

    const dependencies = Object.keys(packageJson.dependencies || {});
    const devDependencies = Object.keys(packageJson.devDependencies || {});

    const allDeps = [...dependencies, ...devDependencies];
    core.info(`AST Parser: Found ${allDeps.length} valid dependencies in package.json`);

    return allDeps;
  } catch (error) {
    core.warning(
      `AST Parser: Could not read package.json: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

export function extractNewSymbols(fileContent: string, filePath: string): string[] {
  const symbols: string[] = [];

  if (
    !filePath.endsWith('.ts') &&
    !filePath.endsWith('.tsx') &&
    !filePath.endsWith('.js') &&
    !filePath.endsWith('.jsx')
  ) {
    return symbols;
  }

  try {
    const tree = parser.parse(fileContent);
    const rootNode = tree.rootNode;

    const functionDeclarations = rootNode.descendantsOfType('function_declaration');
    for (const func of functionDeclarations) {
      const nameNode = func.childForFieldName('name');
      if (nameNode) {
        symbols.push(nameNode.text);
      }
    }

    const classDeclarations = rootNode.descendantsOfType('class_declaration');
    for (const cls of classDeclarations) {
      const nameNode = cls.childForFieldName('name');
      if (nameNode) {
        symbols.push(nameNode.text);
      }
    }

    const interfaceDeclarations = rootNode.descendantsOfType('interface_declaration');
    for (const iface of interfaceDeclarations) {
      const nameNode = iface.childForFieldName('name');
      if (nameNode) {
        symbols.push(nameNode.text);
      }
    }

    const typeAliasDeclarations = rootNode.descendantsOfType('type_alias_declaration');
    for (const typeAlias of typeAliasDeclarations) {
      const nameNode = typeAlias.childForFieldName('name');
      if (nameNode) {
        symbols.push(nameNode.text);
      }
    }

    const arrowFunctions = rootNode.descendantsOfType('lexical_declaration');
    for (const decl of arrowFunctions) {
      const variableDeclarator = decl.descendantsOfType('variable_declarator')[0];
      if (variableDeclarator) {
        const nameNode = variableDeclarator.childForFieldName('name');
        const valueNode = variableDeclarator.childForFieldName('value');
        if (nameNode && valueNode && valueNode.type === 'arrow_function') {
          symbols.push(nameNode.text);
        }
      }
    }

    core.info(`AST Parser: Extracted ${symbols.length} new symbols from ${filePath}`);
  } catch (error) {
    core.warning(
      `AST Parser: Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return symbols;
}

export function extractIgnoredLines(diffContent: string): Set<string> {
  const ignoredLines = new Set<string>();
  const lines = diffContent.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('// ceda-ignore') || line.includes('/* ceda-ignore */')) {
      ignoredLines.add(String(i + 1));
    }
  }

  core.info(`AST Parser: Found ${ignoredLines.size} lines marked with ceda-ignore`);
  return ignoredLines;
}

export async function buildLLMContext(
  projectRoot: string,
  modifiedFiles: string[],
  fileContents: Map<string, string>,
  diffContent: string
): Promise<LLMContext> {
  const validDependencies = await extractValidDependencies(projectRoot);

  const newSymbols: string[] = [];
  for (const [filePath, content] of fileContents.entries()) {
    const symbols = extractNewSymbols(content, filePath);
    newSymbols.push(...symbols);
  }

  const ignoredLines = extractIgnoredLines(diffContent);

  return {
    validDependencies,
    newSymbols,
    modifiedFiles,
    ignoredLines,
  };
}
