// The page Trello opens from the Matrix and Show on matrix buttons: one call. The logic, and its tests, are in
// src/trello/start.ts (bootMatrix); this file only hands it the real page.
import { bootMatrix } from './trello/start';
import { mountMatrix } from './view/app';

void bootMatrix({ window, document, mount: mountMatrix });
