/**
 * Enum for danmaku display types
 */
const DanmakuType = {
  Float: 0,   // Scrolling from right to left
  Bottom: 1,  // Fixed at bottom
  Top: 2,     // Fixed at top
};

/**
 * Base class for danmaku format parsers
 */
class DanmakuParser {
  parse(data) {
    throw new Error('parse() must be implemented by subclass');
  }
}

/**
 * Parser for BiliBili's XML format
 */
class BilibiliXMLParser extends DanmakuParser {
  parse(xmlString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
    const danmakus = [];

    // Get all 'd' elements (danmaku entries)
    const elements = xmlDoc.getElementsByTagName('d');
    
    for (const element of elements) {
      try {
        const p = element.getAttribute('p').split(',');
        const text = element.textContent;

        // Extract values from p attribute
        const time = parseFloat(p[0]);     // Appearance time
        const rawMode = parseInt(p[1]);     // Original bilibili mode
        const fontSize = parseInt(p[2]);    // Font size (ignored)
        const color = '#' + parseInt(p[3]).toString(16).padStart(6, '0');  // Color
        const timestamp = parseInt(p[4]);   // Timestamp (ignored)
        const pool = parseInt(p[5]);        // Pool (ignored)
        const userId = p[6];                // User ID
        const rowId = parseInt(p[7]);       // Row ID (ignored)

        // Convert bilibili mode to DanmakuType
        const mode = this._convertMode(rawMode);

        // Create danmaku item
        const item = [time, mode, color, userId, text];
        danmakus.push(item);

        // Log the parsed item
        console.log('Parsed danmaku:', {
          time,
          originalMode: rawMode,
          convertedMode: mode,
          color,
          userId,
          text
        });
      } catch (e) {
        console.warn('Failed to parse danmaku element:', e);
      }
    }

    return {
      code: 0,
      data: danmakus
    };
  }

  _convertMode(bilibiliMode) {
    // Map bilibili mode to DanmakuType
    switch (bilibiliMode) {
      case 1:  // Regular scrolling
        return DanmakuType.Float;
      case 4:  // Bottom fixed
        return DanmakuType.Bottom;
      case 5:  // Top fixed
        return DanmakuType.Top;
      default:
        console.warn('Unknown bilibili mode:', bilibiliMode, 'defaulting to Float');
        return DanmakuType.Float;
    }
  }
}

export {
  DanmakuType,
  DanmakuParser,
  BilibiliXMLParser,
}; 