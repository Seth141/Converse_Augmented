import type { TpaSession } from '@augmentos/sdk';

const LINE_WIDTH = 48;
const LEFT_MARGIN = 6;
const TOP_BLANK_LINES = 3;

const MARGIN_PAD = ' '.repeat(LEFT_MARGIN);

function padLine(line: string, width: number): string {
    const t = line.trimEnd().slice(0, width);
    return MARGIN_PAD + t + ' '.repeat(Math.max(0, width - t.length));
}

/**
 * Single showTextWall with both lines padded to full width.
 * Blank lines above push content lower; left margin pushes it right.
 */
export function showHudText(session: TpaSession, text: string): void {
    const parts = text.split('\n').map((l) => l.trim());
    const top = parts[0] ?? '';
    const bottom = parts.length > 1 ? (parts[1] ?? '') : '';

    if (!top && !bottom) {
        return;
    }

    const blank = ' '.repeat(LINE_WIDTH + LEFT_MARGIN);
    const prefix = Array(TOP_BLANK_LINES).fill(blank).join('\n');
    const wall = `${prefix}\n${padLine(top, LINE_WIDTH)}\n${padLine(bottom, LINE_WIDTH)}`;
    session.layouts.showTextWall(wall);
}
