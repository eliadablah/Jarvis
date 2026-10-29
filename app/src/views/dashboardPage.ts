import type { AppConfig } from '../config.ts';
import { escapeHtml } from './homePage.ts';
export function renderDashboardPage(config: AppConfig): string {
return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#10251d"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/jarvis-icon.svg"><link rel="stylesheet" href="/dashboard.css"><link rel="stylesheet" href="/dashboard-live.css"><link rel="stylesheet" href="/dashboard-theme.css"><title>Jarvis · Your personal assistant</title></head><body><div id="app" data-env="${escapeHtml(config.env)}" data-version="${escapeHtml(config.version)}"></div><script type="module" src="/dashboard.js"></script><noscript>Enable JavaScript to use the Jarvis dashboard.</noscript></body></html>`;
}
