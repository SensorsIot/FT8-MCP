import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// WSJT-X uses ~1.46 Hz per bin for FT8
const HZ_PER_BIN = 1.4648;

// Target frequency range for Wide Graph (0-2500 Hz)
const TARGET_FREQ_RANGE = 2500;

/**
 * Detect primary screen dimensions (Windows, no PowerShell)
 * Uses WMIC; falls back to 2560x1440 if detection fails
 */
export async function detectScreenDimensions(
    fallback: ScreenDimensions = { width: 1920, height: 1080 }
): Promise<ScreenDimensions> {
    try {
        const { stdout } = await execAsync(
            'wmic path Win32_VideoController get CurrentHorizontalResolution,CurrentVerticalResolution /value',
            { windowsHide: true }
        );
        const lines = stdout
            .split(/\r?\n/)
            .map(l => l.trim())
            .filter(Boolean);

        let width: number | null = null;
        let height: number | null = null;

        for (const line of lines) {
            if (line.startsWith('CurrentHorizontalResolution=')) {
                width = Number(line.split('=')[1]);
            } else if (line.startsWith('CurrentVerticalResolution=')) {
                height = Number(line.split('=')[1]);
            }
        }

        if (width && height && Number.isFinite(width) && Number.isFinite(height)) {
            return { width, height };
        }
        console.warn(
            `detectScreenDimensions: unexpected output "${stdout.trim()}", using fallback ${fallback.width}x${fallback.height}`
        );
    } catch (error) {
        console.warn(`detectScreenDimensions: failed to query screen size, using fallback ${fallback.width}x${fallback.height}`, error);
    }
    return fallback;
}

export interface WindowLayout {
    mainWindow: { x: number; y: number; width: number; height: number };
    wideGraph: { x: number; y: number; width: number; height: number };
    binsPerPixel: number;  // Calculated BinsPerPixel setting for WSJT-X
}

export interface WindowConfig {
    sliceIndex: number;
    screenWidth?: number;       // Full screen width (default 2560)
    screenHeight?: number;      // Full screen height (default 1440)
    taskbarHeight?: number;     // Height reserved for taskbar (default 48)
}

export interface ScreenDimensions {
    width: number;
    height: number;
}

/**
 * Calculate window layout for a slice using quadrant-based positioning
 * Reserves space for the Windows taskbar at the bottom
 *
 * Screen divided into 4 quadrants:
 *   Slice 0: Top-Left     | Slice 1: Top-Right
 *   Slice 2: Bottom-Left  | Slice 3: Bottom-Right
 *
 * Within each quadrant: WideGraph (waterfall) on TOP, Main window BELOW
 */
export function calculateLayout(config: WindowConfig): WindowLayout {
    const {
        sliceIndex,
        screenWidth = 2560,
        screenHeight = 1440,
        taskbarHeight = 48,  // Windows 10/11 taskbar is typically 40-48 pixels
    } = config;

    // Calculate usable screen height (excluding taskbar)
    const usableHeight = screenHeight - taskbarHeight;

    // Calculate quadrant dimensions (exact half of screen width, half of usable height)
    const quadrantWidth = Math.floor(screenWidth / 2);
    const quadrantHeight = Math.floor(usableHeight / 2);

    // Map slice index to quadrant position
    // 0 = top-left, 1 = top-right, 2 = bottom-left, 3 = bottom-right
    const col = sliceIndex % 2;  // 0 = left, 1 = right
    const row = Math.floor(sliceIndex / 2);  // 0 = top, 1 = bottom

    // Calculate quadrant origin (no padding - starts at edge)
    const quadrantX = col * quadrantWidth;
    const quadrantY = row * quadrantHeight;

    // Window dimensions within quadrant (full width)
    const windowWidth = quadrantWidth;
    // Split quadrant height: ~35% for waterfall, ~65% for main window (no gap)
    const wideGraphHeight = Math.floor(quadrantHeight * 0.35);
    const mainWindowHeight = quadrantHeight - wideGraphHeight;

    // Calculate BinsPerPixel to show TARGET_FREQ_RANGE (2500 Hz) in the window width
    // Hz per pixel needed = targetFreq / width
    // BinsPerPixel = hzPerPixel / HZ_PER_BIN
    // Fixed to 3 per user request
    const binsPerPixel = 3;

    return {
        // WideGraph (waterfall) on TOP of quadrant
        wideGraph: {
            x: quadrantX,
            y: quadrantY,
            width: windowWidth,
            height: wideGraphHeight,
        },
        // Main window BELOW the waterfall (directly adjacent, no gap)
        mainWindow: {
            x: quadrantX,
            y: quadrantY + wideGraphHeight,
            width: windowWidth,
            height: mainWindowHeight,
        },
        binsPerPixel,
    };
}

/**
 * Move a window that matches BOTH patterns (for identifying specific Wide Graph windows)
 */
async function moveWindowByTwoPatterns(
    pattern1: string,
    pattern2: string,
    x: number,
    y: number,
    width: number,
    height: number
): Promise<boolean> {
    const script = `
$code = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class Win32Window2 {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
}
'@

Add-Type -TypeDefinition $code -Language CSharp -ErrorAction SilentlyContinue

$pattern1 = "${pattern1}"
$pattern2 = "${pattern2}"
$found = $false

$callback = {
    param([IntPtr]$hWnd, [IntPtr]$lParam)

    if ([Win32Window2]::IsWindowVisible($hWnd)) {
        $sb = New-Object System.Text.StringBuilder 256
        [Win32Window2]::GetWindowText($hWnd, $sb, 256) | Out-Null
        $title = $sb.ToString()

        # Match windows containing BOTH patterns
        if (($title -like "*$pattern1*") -and ($title -like "*$pattern2*")) {
            [Win32Window2]::MoveWindow($hWnd, ${x}, ${y}, ${width}, ${height}, $true) | Out-Null
            $script:found = $true
        }
    }
    return $true
}

[Win32Window2]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

if ($script:found) { "Moved: $pattern1 + $pattern2" } else { "Not found: $pattern1 + $pattern2" }
`;

    try {
        const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
        const { stdout } = await execAsync(`powershell -NoProfile -EncodedCommand ${encodedCommand}`, {
            windowsHide: true,
        });
        console.log(`  Window move result: ${stdout.trim()}`);
        return stdout.includes('Moved:');
    } catch (error) {
        console.error(`  Failed to move window "${pattern1} + ${pattern2}":`, error);
        return false;
    }
}

/**
 * Move a window by its title using PowerShell -EncodedCommand
 * This avoids escaping issues with here-strings
 */
async function moveWindow(
    windowTitle: string,
    x: number,
    y: number,
    width: number,
    height: number
): Promise<boolean> {
    // PowerShell script using inline C# without here-string
    const script = `
$code = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class Win32Window {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
}
'@

Add-Type -TypeDefinition $code -Language CSharp -ErrorAction SilentlyContinue

$targetTitle = "${windowTitle}"
$found = $false

$callback = {
    param([IntPtr]$hWnd, [IntPtr]$lParam)

    if ([Win32Window]::IsWindowVisible($hWnd)) {
        $sb = New-Object System.Text.StringBuilder 256
        [Win32Window]::GetWindowText($hWnd, $sb, 256) | Out-Null
        $title = $sb.ToString()

        if ($title -like "*$targetTitle*") {
            [Win32Window]::MoveWindow($hWnd, ${x}, ${y}, ${width}, ${height}, $true) | Out-Null
            $script:found = $true
        }
    }
    return $true
}

[Win32Window]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

if ($script:found) { "Moved: $targetTitle" } else { "Not found: $targetTitle" }
`;

    try {
        // Encode the script as Base64 for -EncodedCommand
        const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
        const { stdout } = await execAsync(`powershell -NoProfile -EncodedCommand ${encodedCommand}`, {
            windowsHide: true,
        });
        console.log(`  Window move result: ${stdout.trim()}`);
        return stdout.includes('Moved:');
    } catch (error) {
        console.error(`  Failed to move window "${windowTitle}":`, error);
        return false;
    }
}

/**
 * Position WSJT-X windows for a specific instance
 * @param rigName The rig name used for the instance
 * @param sliceIndex The slice index (0=A, 1=B, etc.)
 * @param retries Number of retries (windows may not be ready immediately)
 */
export async function positionWsjtxWindows(
    rigName: string,
    sliceIndex: number,
    retries: number = 5
): Promise<void> {
    const layout = calculateLayout({ sliceIndex });

    console.log(`\nPositioning WSJT-X windows for ${rigName} (Slice ${sliceIndex}):`);
    console.log(`  Main window: ${layout.mainWindow.x},${layout.mainWindow.y} (${layout.mainWindow.width}x${layout.mainWindow.height})`);
    console.log(`  Wide Graph:  ${layout.wideGraph.x},${layout.wideGraph.y} (${layout.wideGraph.width}x${layout.wideGraph.height})`);

    // Wait a bit for windows to be created
    await new Promise(resolve => setTimeout(resolve, 2000));

    for (let attempt = 1; attempt <= retries; attempt++) {
        console.log(`  Attempt ${attempt}/${retries}...`);

        // WSJT-X main window title format: "WSJT-X   v2.x.x   by K1JT et al. - rigName"
        // or just "WSJT-X" with rigName in title
        const mainMoved = await moveWindow(
            rigName,
            layout.mainWindow.x,
            layout.mainWindow.y,
            layout.mainWindow.width,
            layout.mainWindow.height
        );

        // Wide Graph window title includes rigName: "Wide Graph - rigName"
        const wideGraphMoved = await moveWindowByTwoPatterns(
            'Wide Graph',
            rigName,
            layout.wideGraph.x,
            layout.wideGraph.y,
            layout.wideGraph.width,
            layout.wideGraph.height
        );

        if (mainMoved && wideGraphMoved) {
            console.log(`  Windows positioned successfully!`);
            return;
        }

        // Wait before retry
        if (attempt < retries) {
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
    }

    console.log(`  Warning: Could not position all windows after ${retries} attempts`);
}

/**
 * Position all WSJT-X instances based on a slice mapping
 */
export async function positionAllWindows(
    sliceMapping: Map<string, { rigName: string; sliceIndex: number }>
): Promise<void> {
    for (const [sliceId, info] of sliceMapping) {
        await positionWsjtxWindows(info.rigName, info.sliceIndex);
    }
}
