import { DanmakuType, BilibiliXMLParser } from './parser.js';

/**
 * Enum for CreepyBird states
 */
const CreepyBirdState = {
  Empty: 'empty',         // Initial state, no video attached
  Hide: 'hide',          // Danmaku is loaded but hidden
  Playing: 'playing',    // Danmaku is showing and playing
  Paused: 'paused'       // Danmaku is showing but paused
};

// Main library entry point
export default class CreepyBird {
  constructor() {
    this.version = '1.0.0';
    this.overlayElement = null;
    this._data = null;
    this._isVisible = false;  // Add visibility state
    this._intervalId = null;  // Add interval ID tracker
    this._videoElement = null;  // Store video element reference
    this.danmakuSpeed = 100;   // Base speed in pixels per second
    this._fontSize = 24;        // font size in pixels
    this._lineSpacing = 1.2;    // line spacing multiplier
    this._lineMargin = 50;     // Default gap between danmaku in pixels
    this._danmakuLines = [];  // Array of DanmakuLine objects
    this._nextDanmakuIndex = null;  // Renamed from _lastDanmakuIndex
    this._activeDanmaku = new Set();  // Track active danmaku
    this._debug = false;  // Debug flag
    this._handlers = {
      play: null,
      pause: null,
      seeking: null
    };
    this._state = CreepyBirdState.Empty;  // Initialize state to Empty
    this._resizeObserver = null;  // Store ResizeObserver instance
    this._intersectionObserver = null;  // Store IntersectionObserver instance
  }

  // Helper method for debug logging
  _log(...args) {
    if (this._debug) {
      console.log(...args);
    }
  }

  setDebug(enabled) {
    this._debug = enabled;
    return this;
  }

  attachToVideo(videoElement) {
    this._log('Attaching to video element:', videoElement);

    // Detach if attaching to a different video while not in Empty state
    if (this._state !== CreepyBirdState.Empty) {
      this._log('Detaching from previous video before attaching to new one');
      this.detach();
    }

    this._videoElement = videoElement;
    this.overlayElement = document.createElement('div');

    // Get video position and size
    const videoRect = videoElement.getBoundingClientRect();

    // Set overlay position and size based on video
    this.overlayElement.style.position = 'absolute';
    this.overlayElement.style.left = `${videoRect.left}px`;
    this.overlayElement.style.top = `${videoRect.top}px`;
    this.overlayElement.style.width = `${videoRect.width}px`;
    this.overlayElement.style.height = `${videoRect.height}px`;
    this.overlayElement.style.pointerEvents = 'none';
    this.overlayElement.style.zIndex = '2147483647';  // Maximum z-index
    this.overlayElement.style.overflow = 'hidden';

    // Add to document body instead of video container
    document.body.appendChild(this.overlayElement);

    // Update overlay position function
    const updatePosition = (trigger) => {
      const videoRect = this._videoElement.getBoundingClientRect();
      const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      
      this._log('Updating overlay position:', {
        clientLeft: videoRect.left,
        clientTop: videoRect.top,
        scrollLeft,
        scrollTop,
        pageLeft: videoRect.left + scrollLeft,
        pageTop: videoRect.top + scrollTop,
        width: videoRect.width,
        height: videoRect.height,
        trigger
      });
      
      this.overlayElement.style.left = `${videoRect.left + scrollLeft}px`;
      this.overlayElement.style.top = `${videoRect.top + scrollTop}px`;
      this.overlayElement.style.width = `${videoRect.width}px`;
      this.overlayElement.style.height = `${videoRect.height}px`;

      this.updateDanmakuLines();
    };

    // Create and store intersection observer
    this._intersectionObserver = new IntersectionObserver(
      (entries) => {
        updatePosition('_intersectionObserver');
      },
      {
        threshold: [0, 1],
        root: null
      }
    );
    this._intersectionObserver.observe(videoElement);
    this._log('IntersectionObserver created and attached to video element');

    // Create and store resize observer
    this._resizeObserver = new ResizeObserver(() => {
      updatePosition('_resizeObserver');
    });
    this._resizeObserver.observe(videoElement);
    this._log('ResizeObserver created and attached to video element');

    // Store handlers for cleanup
    this._handlers = {
      play: () => {
        this._log('Video play event detected');
        this.resume();
      },
      pause: () => {
        this._log('Video pause event detected');
        this.pause();
      },
      seeking: () => {
        this._log('Video seek event detected, current time:', videoElement.currentTime);
        this.seek(videoElement.currentTime);
      },
    };

    // Add video playback event listeners
    videoElement.addEventListener('play', this._handlers.play);
    videoElement.addEventListener('pause', this._handlers.pause);
    videoElement.addEventListener('seeking', this._handlers.seeking);

    // Initialize danmaku lines
    this.updateDanmakuLines();

    // Set state to Hide after setup
    this._state = CreepyBirdState.Hide;
    this._log('State transitioned to Hide');

    this._log('Video attachment complete, overlay created');
    return this.overlayElement;
  }

  load(url, format = 'json') {
    this._log('Loading danmaku from URL:', url, 'format:', format);

    // Remember current state
    const previousState = this._state;
    
    // If not in Empty or Hide state, transition to Hide first
    if (![CreepyBirdState.Empty, CreepyBirdState.Hide].includes(previousState)) {
      this._log('Transitioning to Hide state before loading');
      this.hide();
    }

    return this._load(url)
      .then(data => {
        let parsedData;
        
        // Parse data based on format
        if (format.toLowerCase() === 'bilibilixml') {
          const parser = new BilibiliXMLParser();
          parsedData = parser.parse(data);
          if (parsedData.code !== 0) {
            throw new Error('Failed to parse XML data');
          }
          data = parsedData.data;
        }

        // Convert raw data array into Danmaku objects and sort by time
        this._data = data
          .map(([time, mode, color, userId, text]) => 
            new Danmaku(time, mode, color, userId, text)
          )
          .sort((a, b) => a.time - b.time);
        
        this._log(`Loaded ${this._data.length} danmaku messages`);

        // Restore previous state if it wasn't Empty or Hide
        if (![CreepyBirdState.Empty, CreepyBirdState.Hide].includes(previousState)) {
          this._log('Restoring to previous state:', previousState);
          if (previousState === CreepyBirdState.Playing) {
            this.show();
            this._state = CreepyBirdState.Playing;
          } else if (previousState === CreepyBirdState.Paused) {
            this.show().pause();
            this._state = CreepyBirdState.Paused;
          }
        }

        return this._data;
      });
  }

  _load(url) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      
      // Set response type based on URL extension
      if (url.toLowerCase().endsWith('.xml')) {
        xhr.responseType = 'text';  // For XML we want text
      } else {
        xhr.responseType = 'json';  // For JSON we want parsed JSON
      }
      
      xhr.onload = () => {
        if (xhr.status === 200) {
          if (xhr.responseType === 'json') {
            // JSON response
            const response = xhr.response;
            if (response.code === 0) {
              resolve(response.data);
            } else {
              reject(new Error(`Invalid response code: ${response.code}`));
            }
          } else {
            // XML/text response
            resolve(xhr.responseText);
          }
        } else {
          reject(new Error(`HTTP error! status: ${xhr.status}`));
        }
      };
      
      xhr.onerror = () => {
        reject(new Error('Network request failed'));
      };
      
      xhr.send();
    });
  }

  _startInterval() {
    if (!this._intervalId) {
      this._intervalId = setInterval(() => {
        if (this._videoElement) {
          this.loadDanmaku(this._videoElement.currentTime);
          this.cleanupDanmaku();
        }
      }, 100);
    }
  }

  show() {
    this._log('Showing danmaku overlay');

    // Do nothing if not in Hide state
    if (this._state !== CreepyBirdState.Hide) {
      this._log('Cannot show: not in Hide state, current state:', this._state);
      return this;
    }

    this._isVisible = true;
    if (this.overlayElement) {
      this.overlayElement.style.display = 'block';
    }
    this._startInterval();

    // First transition to Playing state
    this._state = CreepyBirdState.Playing;
    this._log('State transitioned to Playing');

    // Then check if video is paused and transition accordingly
    if (this._videoElement && this._videoElement.paused) {
      this._log('Video is paused, transitioning to Paused state');
      this.pause();
    }

    return this;
  }

  _clearInterval() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
      this._nextDanmakuIndex = null;  // Reset next danmaku index
      this._log('Interval cleared and next danmaku index reset');
    }
  }

  hide() {
    this._log('Hiding danmaku overlay');

    // Do nothing if in Empty state
    if (this._state === CreepyBirdState.Empty) {
      this._log('Cannot hide in Empty state');
      return this;
    }

    this._isVisible = false;
    if (this.overlayElement) {
      this.overlayElement.style.display = 'none';
    }

    this._clearInterval();
    
    // Set state to Hide
    this._state = CreepyBirdState.Hide;
    this._log('State transitioned to Hide');

    return this;
  }

  // Helper method to check visibility state
  isVisible() {
    return this._isVisible;
  }

  searchCurDanmaku(time, startIndex = 0) {
    this._log('Searching for danmaku at time:', time, 'starting from:', startIndex);
    if (!this._data || this._data.length === 0) {
      return null;
    }

    let left = startIndex;
    let right = this._data.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const midTime = this._data[mid].time;

      if (midTime === time) {
        return mid;
      }

      if (midTime < time) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    return left < this._data.length ? left : null;
  }

  seek(time) {
    return this._nextDanmakuIndex = null;
  }

  calDanmakuDuration(danmaku) {
    this._log('Calculated duration for danmaku:', danmaku.text);
    if (!this._videoElement) {
      return 0;
    }

    const videoWidth = this._videoElement.clientWidth;
    
    if (danmaku.mode === DanmakuType.Float) {
      // Calculate how long it takes to cross the screen
      const duration = videoWidth / this.danmakuSpeed;
      return duration;
    }
    
    // For Bottom and Top types
    if (danmaku.mode === DanmakuType.Bottom || 
        danmaku.mode === DanmakuType.Top) {
      return 5; // Show static danmaku for 5 seconds
    }

    return 0; // Default case
  }

  setFontSize(size) {
    this._log('Setting font size to:', size);
    this._fontSize = size;
    return this;
  }

  calAvailableLines() {
    this._log('Calculated available lines');
    if (!this._videoElement) {
      return 0;
    }

    const videoHeight = this._videoElement.clientHeight;
    const lineHeight = Math.ceil(this._fontSize * this._lineSpacing);  // Add some spacing between lines
    
    // Calculate max lines and return as integer
    const lines = Math.floor(videoHeight / lineHeight);
    this._log('Calculated available lines:', lines);
    return lines;
  }

  updateDanmakuLines() {
    this._log('Updating danmaku lines');
    const availableLines = this.calAvailableLines();
    const currentLines = this._danmakuLines.length;
    const videoWidth = this._videoElement.clientWidth;
    const videoHeight = this._videoElement.clientHeight;

    this._log(`Video size: ${videoWidth}x${videoHeight}`);
    this._log(`Lines: ${currentLines} -> ${availableLines}`);

    if (availableLines === currentLines) {
      return;  // No change needed
    }

    if (availableLines < currentLines) {
      // Remove excess lines from the end
      while (this._danmakuLines.length > availableLines) {
        const line = this._danmakuLines.pop();
        line.clear();  // Clean up the removed line
      }
    } else {
      // Add new lines
      while (this._danmakuLines.length < availableLines) {
        this._danmakuLines.push(new DanmakuLine());
      }
    }
  }

  setLineMargin(margin) {
    this._log('Setting line margin to:', margin);
    if (margin < 0) {
      throw new Error('Line margin must be non-negative');
    }
    this._lineMargin = margin;
    return this;
  }

  pickLine(danmakuItem) {
    this._log('Picking line for danmaku:', danmakuItem.danmaku.text);
    if (!this._danmakuLines.length) {
      return null;
    }

    // Handle fixed danmaku (Bottom and Top types)
    if (danmakuItem.danmaku.mode === DanmakuType.Bottom || 
        danmakuItem.danmaku.mode === DanmakuType.Top) {
      const lines = [...this._danmakuLines];
      // For bottom danmaku, search from bottom up
      if (danmakuItem.danmaku.mode === DanmakuType.Bottom) {
        lines.reverse();
      }
      // Find first line without fixed danmaku
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].hasFixed()) {
          return this._danmakuLines.indexOf(lines[i]);
        }
      }
      return null;
    }

    // Handle floating danmaku
    const videoWidth = this._videoElement.clientWidth;

    // Check each line from top to bottom
    for (let i = 0; i < this._danmakuLines.length; i++) {
      const line = this._danmakuLines[i];

      // If line is empty, we can use it
      if (line.queue.length === 0) {
        return i;
      }

      // Check last danmaku in the line
      const lastItem = line.queue[line.queue.length - 1];
      const lastItemRect = lastItem.element.getBoundingClientRect();
      const rightEdge = lastItemRect.right;
      const margin = videoWidth - rightEdge;

      // If there's enough margin after the last item, we can use this line
      if (margin >= this._lineMargin) {
        return i;
      }
    }

    return null;  // No suitable line found
  }

  loadDanmaku(currentTime) {
    this._log('Loading danmaku for time:', currentTime, 'Active danmaku:', this._activeDanmaku.size);
    if (!this._data || !this._isVisible) {
      this._log('Skipping loadDanmaku: data or visibility check failed');
      return;
    }

    // Keep loading danmaku until none are available for current time
    while (true) {
      let index;
      
      // Use nextDanmakuIndex if available, otherwise search
      if (this._nextDanmakuIndex !== null && this._nextDanmakuIndex < this._data.length) {
        this._log('Using cached next index:', this._nextDanmakuIndex);
        index = this._nextDanmakuIndex;
      } else {
        this._log('Searching for danmaku at current time');
        index = this.searchCurDanmaku(currentTime);
        if (index === null) {
          this._log('No more danmaku found for current time');
          break;
        }
      }

      const danmaku = this._data[index];

      // Skip if danmaku is already active
      if (this._activeDanmaku.has(danmaku)) {
        this._log('Skipping already active danmaku:', danmaku.text);
        this._nextDanmakuIndex = index + 1;
        continue;
      }

      this._log('Processing danmaku:', danmaku.text, 'at time:', danmaku.time, 'mode:', danmaku.mode);

      // Check if the danmaku is within 100ms of current time
      const timeDiff = Math.abs(danmaku.time - currentTime);
      if (timeDiff > 0.1) {
        this._log('Danmaku too far from current time, diff:', timeDiff);
        break;
      }

      // Update next index for next iteration
      this._nextDanmakuIndex = index + 1;
      this._log('Updated next index to:', this._nextDanmakuIndex);

      const danmakuItem = new DanmakuItem(danmaku, this);
      
      // Find available line
      const lineIndex = this.pickLine(danmakuItem);
      if (lineIndex === null) {
        this._log('No available line for danmaku:', danmaku.text);
        danmakuItem.remove();
        continue;
      }
      this._log('Selected line:', lineIndex, 'for danmaku:', danmaku.text);

      // Add to active set
      this._activeDanmaku.add(danmaku);
      this._log('Added to active set, new size:', this._activeDanmaku.size);

      const line = this._danmakuLines[lineIndex];
      const videoWidth = this._videoElement.clientWidth;
      const lineHeight = this._videoElement.clientHeight / this._danmakuLines.length;
      const verticalPosition = Math.ceil(lineIndex * lineHeight);

      this._log('Positioning danmaku:', {
        lineIndex,
        verticalPosition,
        videoWidth,
        lineHeight
      });

      // Position the element
      danmakuItem.element.style.top = `${verticalPosition}px`;

      if (danmaku.mode === DanmakuType.Float) {  // Floating danmaku
        this._log('Setting up scrolling animation for danmaku:', danmaku.text);
        // Set initial position
        danmakuItem.element.style.left = `${videoWidth}px`;
        
        // Calculate animation duration
        const duration = this.calDanmakuDuration(danmaku);
        
        // Set up animation
        danmakuItem.element.style.transition = `left ${duration}s linear`;
        danmakuItem.element.style.visibility = 'visible';
        
        // Add keyframe animation style for this specific danmaku
        const animationName = `danmaku-${Date.now()}`;
        const keyframes = `
          @keyframes ${animationName} {
            from { left: ${videoWidth}px; }
            to { left: -${danmakuItem.getLength()}px; }
          }
        `;
        const styleSheet = document.createElement('style');
        styleSheet.textContent = keyframes;
        document.head.appendChild(styleSheet);
        
        // Apply the animation
        danmakuItem.element.style.animation = `${animationName} ${duration}s linear`;

        // Add to line queue
        line.push(danmakuItem);
      } else {  // Fixed danmaku (Bottom or Top)
        this._log('Setting up fixed position for danmaku:', danmaku.text);
        // Center horizontally
        const itemLength = danmakuItem.getLength();
        danmakuItem.element.style.left = `${(videoWidth - itemLength) / 2}px`;
        danmakuItem.element.style.visibility = 'visible';

        // Add as fixed item
        line.setFixed(danmakuItem);
      }
    }
  }

  cleanupDanmaku() {
    this._log('Starting danmaku cleanup');
    if (!this._isVisible || !this._videoElement) {
      return;
    }

    const currentTime = this._videoElement.currentTime;

    this._danmakuLines.forEach(line => {
      // Clean up scrolling danmaku
      while (line.queue.length > 0) {
        const frontItem = line.queue[0];
        const animationState = frontItem.element.getAnimations()[0]?.playState;
        if (animationState === 'finished' || !animationState) {
          this._activeDanmaku.delete(frontItem.danmaku);  // Remove from active set
          frontItem.remove();
          line.queue.shift();
        } else {
          break;
        }
      }

      // Clean up fixed danmaku
      if (line.fixedItem) {
        const item = line.fixedItem;
        const displayTime = currentTime - item.danmaku.time;
        if (displayTime >= this.calDanmakuDuration(item.danmaku)) {
          this._activeDanmaku.delete(item.danmaku);  // Remove from active set
          line.removeFixed();
        }
      }
    });

    this._log('Cleanup complete, active danmaku:', this._activeDanmaku.size);
  }

  pause() {
    this._log('Pausing danmaku animations');
    
    // Do nothing if not in Playing state
    if (this._state !== CreepyBirdState.Playing) {
      this._log('Cannot pause: not in Playing state, current state:', this._state);
      return this;
    }

    this._clearInterval();

    // Pause all animations in each line
    this._danmakuLines.forEach(line => {
      // Pause scrolling danmaku
      line.queue.forEach(item => {
        const animation = item.element.getAnimations()[0];
        if (animation) {
          animation.pause();
        }
      });

      // No need to pause fixed danmaku as they don't animate
    });

    // Set state to Paused
    this._state = CreepyBirdState.Paused;
    this._log('State transitioned to Paused');

    return this;
  }

  resume() {
    this._log('Resuming danmaku animations');
    
    // Do nothing if not in Paused state
    if (this._state !== CreepyBirdState.Paused) {
      this._log('Cannot resume: not in Paused state, current state:', this._state);
      return this;
    }

    this._startInterval();

    // Resume all animations in each line
    this._danmakuLines.forEach(line => {
      // Resume scrolling danmaku
      line.queue.forEach(item => {
        const animation = item.element.getAnimations()[0];
        if (animation) {
          animation.play();
        }
      });

      // No need to resume fixed danmaku as they don't animate
    });

    // Set state to Playing
    this._state = CreepyBirdState.Playing;
    this._log('State transitioned to Playing');

    return this;
  }

  detach() {
    this._log('Detaching from video element');

    this._clearInterval();
    
    if (!this._videoElement) {
      this._log('No video element to detach from');
      return this;
    }

    // Disconnect and clear observers
    if (this._resizeObserver) {
      this._log('Disconnecting ResizeObserver');
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    if (this._intersectionObserver) {
      this._log('Disconnecting IntersectionObserver');
      this._intersectionObserver.disconnect();
      this._intersectionObserver = null;
    }

    // Remove video event listeners
    if (this._videoElement && this._handlers) {
      this._videoElement.removeEventListener('play', this._handlers.play);
      this._videoElement.removeEventListener('pause', this._handlers.pause);
      this._videoElement.removeEventListener('seeking', this._handlers.seeking);
    }

    // Clear all danmaku lines
    this._danmakuLines.forEach(line => line.clear());
    this._danmakuLines = [];

    // Remove overlay element
    if (this.overlayElement && this.overlayElement.parentNode) {
      this.overlayElement.parentNode.removeChild(this.overlayElement);
    }

    // Clear references
    this.overlayElement = null;
    this._videoElement = null;
    this._nextDanmakuIndex = null;
    this._activeDanmaku.clear();

    // Clear handler references
    this._handlers = {
      play: null,
      pause: null,
      seeking: null
    };

    // Reset state to Empty
    this._state = CreepyBirdState.Empty;

    this._log('Detach complete');
    return this;
  }
}

class Danmaku {
  constructor(time, mode, color, userId, text) {
    this.time = time;          // Time in seconds (float)
    this.mode = this._validateMode(mode);  // DanmakuType
    this.color = color;        // String (hex color)
    this.userId = userId;      // Integer
    this.text = text;          // String
  }

  _validateMode(mode) {
    // Validate that mode is one of DanmakuType values
    if (![DanmakuType.Float, DanmakuType.Bottom, DanmakuType.Top].includes(mode)) {
      throw new Error('Invalid danmaku mode');
    }
    return mode;
  }
}

class DanmakuItem {
  constructor(danmaku, creepyBird) {
    if (!danmaku) {
      throw new Error('Danmaku object is required');
    }
    if (!creepyBird) {
      throw new Error('CreepyBird instance is required');
    }
    if (!creepyBird.overlayElement) {
      throw new Error('CreepyBird overlay element is not initialized');
    }

    this.danmaku = danmaku;
    this.element = document.createElement('div');

    // Initialize the element with danmaku properties
    this.element.textContent = danmaku.text;
    this.element.style.color = danmaku.color;
    this.element.style.position = 'absolute';
    this.element.style.whiteSpace = 'nowrap';
    this.element.style.fontFamily = 'Arial, sans-serif';
    this.element.style.fontSize = `${creepyBird._fontSize}px`;
    this.element.style.fontWeight = 'bold';  // Add bold font weight
    this.element.style.userSelect = 'none';
    this.element.style.webkitTextStroke = '1px black';
    this.element.style.visibility = 'hidden';

    // Add the element to the overlay
    creepyBird.overlayElement.appendChild(this.element);
  }

  // Get the width of the element in pixels
  getLength() {
    const width = this.element.offsetWidth;
    return width;
  }

  // Helper method to remove the element from DOM
  remove() {
    if (this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

class DanmakuLine {
  constructor() {
    this.queue = [];           // Queue of scrolling DanmakuItem objects
    this.fixedItem = null;     // Optional fixed DanmakuItem (for top/bottom modes)
  }

  // Add a new DanmakuItem to the queue (only for scrolling items)
  push(item) {
    if (!(item instanceof DanmakuItem)) {
      throw new Error('Only DanmakuItem objects can be added to the queue');
    }
    this.queue.push(item);
  }

  // Set fixed position danmaku
  setFixed(item) {
    if (!(item instanceof DanmakuItem)) {
      throw new Error('Only DanmakuItem objects can be set as fixed');
    }

    // Remove existing fixed item if any
    if (this.fixedItem) {
      this.fixedItem.remove();
    }
    this.fixedItem = item;
  }

  // Remove and return the oldest DanmakuItem from the queue
  pop() {
    if (this.queue.length === 0) {
      return null;
    }
    const item = this.queue.shift();
    item.remove();  // Remove the element from DOM
    return item;
  }

  // Remove fixed item if exists
  removeFixed() {
    if (this.fixedItem) {
      this.fixedItem.remove();
      this.fixedItem = null;
    }
  }

  // Check if line has a fixed danmaku
  hasFixed() {
    return this.fixedItem !== null;
  }

  // Get the number of items in the queue (excluding fixed item)
  get length() {
    return this.queue.length;
  }

  // Clear all items from the queue and fixed item
  clear() {
    while (this.queue.length > 0) {
      this.pop();
    }
    this.removeFixed();
  }
}

export {
  CreepyBirdState
};
