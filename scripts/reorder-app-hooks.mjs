import fs from 'fs';

const path = 'src/app/App.jsx';
const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);

const lifecycleStart = lines.findIndex((l) => l.trim() === 'const {') &&
    lines.findIndex((l, i) => i > 700 && l.includes('} = useRoomLifecycle({'));
// Find useRoomLifecycle block more reliably
let startIdx = -1;
let endIdx = -1;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('} = useRoomLifecycle({')) {
        endIdx = i;
        for (let j = i; j >= 0; j--) {
            if (lines[j].trim() === 'const {') {
                startIdx = j;
                break;
            }
        }
        break;
    }
}

if (startIdx < 0 || endIdx < 0) {
    console.error('Could not find useRoomLifecycle block', startIdx, endIdx);
    process.exit(1);
}

// Include ref effects after lifecycle
let blockEnd = endIdx + 1;
while (blockEnd < lines.length) {
    const line = lines[blockEnd].trim();
    if (line.startsWith('useEffect(() => {') && lines[blockEnd + 1]?.includes('openRoomAsGuestRef')) {
        while (blockEnd < lines.length && !lines[blockEnd].includes('}, [openRoomAsGuest]);')) blockEnd++;
        blockEnd++;
        continue;
    }
    if (line.startsWith('useEffect(() => {') && lines[blockEnd + 1]?.includes('createHostRoomRef')) {
        while (blockEnd < lines.length && !lines[blockEnd].includes('}, [createHostRoom]);')) blockEnd++;
        blockEnd++;
        continue;
    }
    break;
}

const lifecycleBlock = lines.slice(startIdx, blockEnd);
const withoutBlock = [...lines.slice(0, startIdx), ...lines.slice(blockEnd)];

const snapshotMarker = withoutBlock.findIndex((l) => l.includes('// Jeden listener RTDB na cały pokój'));
if (snapshotMarker < 0) {
    console.error('Could not find useRoomSnapshot marker');
    process.exit(1);
}

const insertAt = snapshotMarker;
const newLines = [
    ...withoutBlock.slice(0, insertAt),
    '    // =========================================================================',
    '    // Room lifecycle (join / leave / kick / create)',
    '    // =========================================================================',
    ...lifecycleBlock,
    '',
    ...withoutBlock.slice(insertAt),
];

fs.writeFileSync(path, newLines.join('\n'));
console.log('Moved useRoomLifecycle before useRoomSnapshot', startIdx, blockEnd, '->', insertAt);
