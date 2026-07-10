const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

function loadCustomPlatforms() {
    let rawData = [];
    try {
        const data = fs.readFileSync('custom_break_platforms.json', 'utf8');
        const parsed = JSON.parse(data);
        let refW = 3440;
        let refH = 1440;
        
        if (Array.isArray(parsed)) {
            rawData = parsed;
        } else if (parsed && parsed.platforms) {
            rawData = parsed.platforms;
            refW = parsed.resolution.w;
            refH = parsed.resolution.h;
        }
        
        // If resolution is exactly the same, no scaling needed
        if (refW === screenW && refH === screenH) {
            return rawData;
        }
        
        // Simulate CSS object-fit: cover behavior
        const imageW = 3840; // bg_image_1.png dimensions
        const imageH = 1920;
        
        const refScale = Math.max(refW / imageW, refH / imageH);
        const refOffsetX = (refW - imageW * refScale) / 2;
        const refOffsetY = (refH - imageH * refScale) / 2;
        
        const currentScale = Math.max(screenW / imageW, screenH / imageH);
        const currentOffsetX = (screenW - imageW * currentScale) / 2;
        const currentOffsetY = (screenH - imageH * currentScale) / 2;
        
        return rawData.map(p => {
            // Un-scale from the reference screen back to the raw image pixels
            const imgX = (p.x - refOffsetX) / refScale;
            const imgY = (p.y - refOffsetY) / refScale;
            const imgW = p.w / refScale;
            
            // Re-scale from the raw image pixels to the current screen
            return {
                hwnd: p.hwnd,
                title: p.title,
                x: (imgX * currentScale) + currentOffsetX,
                y: (imgY * currentScale) + currentOffsetY,
                w: imgW * currentScale,
                h: p.h
            };
        });
    } catch (e) {
        return [];
    }
}

let openWindows = [];
let previousOpenWindows = [];
let virtualShelves = [];
let isDrawingMode = false;
let currentDrawElement = null;
let drawStartX = 0;
let drawStartY = 0;

let isCustomizingBreak = false;
let normalShelvesBackup = [];
let isErasing = false;

// Productivity Guard: Distracting Keywords
const distractingKeywords = ['youtube', 'discord', 'twitter', 'reddit', 'twitch'];

const screenW = window.screen.availWidth;
const screenH = window.screen.availHeight;

const catScale = screenW / 3440;
document.documentElement.style.setProperty('--cat-scale', catScale);

let mouseX = 0, mouseY = 0;
let lastMouseX = 0, lastMouseY = 0;
let mouseIdleFrames = 0;

let activeContextCat = null;
const contextMenu = document.getElementById('cat-context-menu');

let last20MinTime = Date.now();
let last30MinTime = Date.now();
let last90MinTime = Date.now();
let breakEndTime = 0;
let breakWarningEndTime = 0;
let upcomingBreakDuration = 0;
let upcomingBreakType = '';
let activeBreakType = '';
let longBreakCats = [];
let nextCatSpawnTime = 0;
let wasInBreak = false;

const cats = [];
const birds = [];
let nextBirdSpawnTime = 0;
let placedGifts = [];

let bugX = 500;
let bugY = 500;
let bugTargetX = 500;
let bugTargetY = 500;

function getAllPngFiles(dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);
  arrayOfFiles = arrayOfFiles || [];
  
  const targetFiles = [
      'animatedautum.png',
      'animatedtreecoolcolor.png',
      'animatedtreestartautumn.png',
      'animatedtreewarmcolor.png'
  ];
  
  files.forEach(function(file) {
    if (fs.statSync(dirPath + "/" + file).isDirectory()) {
      arrayOfFiles = getAllPngFiles(dirPath + "/" + file, arrayOfFiles);
    } else {
      const lower = file.toLowerCase();
      if (targetFiles.includes(lower)) {
        arrayOfFiles.push(path.join(dirPath, file));
      }
    }
  });
  return arrayOfFiles;
}

function buildNatureEnvironment() {
    const env = document.getElementById('nature-environment');
    if (!env) return;
    env.innerHTML = '';
    env.style.zIndex = 5;
    
    const bgImage = document.createElement('img');
    bgImage.src = 'cat_bg_images/bg_image_1.png';
    bgImage.className = 'env-background';
    env.appendChild(bgImage);
    
    virtualShelves = loadCustomPlatforms().map(p => ({
        x: p.x,
        y: p.y,
        w: p.w,
        h: 16,
        hwnd: 'shelf-env-' + Math.random().toString(36).substring(2, 9),
        title: 'Virtual Shelf'
    }));
}

function updateGifts(platforms) {
  for (let i = placedGifts.length - 1; i >= 0; i--) {
    const gift = placedGifts[i];
    if (gift === draggedGift) continue;
    
    if (gift.isFalling) {
      const oldCy = gift.y + 32;
      gift.vy += 1.0;
      gift.x += (gift.vx || 0);
      gift.y += gift.vy;
      const cy = gift.y + 32;
      
      const hit = checkCollision(gift.x + 16, cy, oldCy, gift.ignoreHwnd ? {hwnd: gift.ignoreHwnd} : null, platforms);
      if (hit && gift.vy > 0) {
         gift.y = hit.y - 32;
         gift.vy = -gift.vy * 0.5;
         gift.vx = (gift.vx || 0) * 0.7;
         if (Math.abs(gift.vy) < 1.0) gift.vy = 0;
         
         if (gift.vy === 0) {
             gift.isFalling = false;
             gift.hwnd = hit.hwnd;
             gift.offsetX = gift.x - hit.x;
             gift.wasThrown = false;
             gift.ignoreHwnd = null;
         }
      }
      
      if (gift.y > screenH + 100) {
        gift.el.remove();
        placedGifts.splice(i, 1);
      } else {
        gift.el.style.left = `${gift.x}px`;
        gift.el.style.top = `${gift.y}px`;
      }
    } else {
      const win = platforms.find(p => p.hwnd === gift.hwnd);
      if (win) {
         gift.x = win.x + gift.offsetX;
         gift.y = win.y - 32;
         gift.el.style.left = `${gift.x}px`;
         gift.el.style.top = `${gift.y}px`;
      } else {
         gift.isFalling = true;
         gift.vy = 0;
      }
    }
  }
}

function triggerEyeBreak(cat) {
    if (!['ON_PLATFORM', 'IDLE', 'SITTING', 'SLEEPING'].includes(cat.state)) return false;
    
    cat.balloon.innerHTML = "Look 20 feet away<br>for a moment!";
    cat.balloon.className = "cat-speech-balloon";
    cat.balloon.style.display = "block";
    // Turn on the light (dimmer will be activated on collision)
    const dimmer = document.getElementById('screen-dimmer');
    const lightContainer = document.getElementById('light-container');
    const light = document.getElementById('swinging-light');
    
    // Reset the animation so it drops down every time
    lightContainer.style.animation = 'none';
    lightContainer.offsetHeight; // trigger reflow
    lightContainer.style.animation = null;
    
    lightContainer.style.display = 'block';
    light.classList.remove('off');
    light.classList.remove('pulled');
    
    // Trigger the cat to jump to the light after it drops down (1s delay)
    setTimeout(() => {
        cat.state = 'EYE_BREAK_JUMPING';
        cat.setCatClass('pounce');
        cat.isEyeBreakJumping = true;
    }, 1000);
    
    // Cleanup after 20 seconds
    setTimeout(() => {
        dimmer.classList.remove('dimmed');
        lightContainer.style.display = 'none';
        if (cat.balloon.innerHTML.includes("Look 20 feet")) {
            cat.balloon.style.display = "none";
        }
        
        // Fade out audio
        if (window.purrAudio) {
            let fadeOut = setInterval(() => {
                if (window.purrAudio.volume <= 0.05) {
                    window.purrAudio.pause();
                    window.purrAudio.volume = 0;
                    clearInterval(fadeOut);
                } else {
                    window.purrAudio.volume -= 0.05;
                }
            }, 100);
        }
        
        // Wake up cat
        if (cat.isEyeBreakSleeping) {
            cat.state = 'WAKING_UP';
            cat.setCatClass('pounce');
            cat.sprite.style.backgroundPosition = `-256px 0px`;
            cat.stateWaitFrames = 0;
            cat.isEyeBreakSleeping = false;
        }
        
    }, 20000);
    
    return true;
}

function triggerRandomDistraction(cat) {
    if (!['ON_PLATFORM', 'IDLE', 'SITTING', 'SLEEPING'].includes(cat.state)) return false;
    
    cat.setCatClass('idle');
    
    const r = Math.random();
    if (r < 0.33) {
        cat.isFetchingGift = true;
        const giftTypes = ['coffee', 'plant', 'fish', 'yarn', 'mouse'];
        cat.giftType = giftTypes[Math.floor(Math.random() * giftTypes.length)];
        cat.giftBgPos = '';
        cat.state = 'FETCH_GIFT_WALK_OFF';
        cat.pounceVx = cat.x < screenW / 2 ? -15 : 15;
        cat.setCatClass('running');
    } else if (r < 0.66) {
        const platforms = getPlatforms();
        const validWindows = platforms.filter(p => p.w > 200 && p.h > 200 && !String(p.hwnd).startsWith('shelf-') && !String(p.hwnd).startsWith('line-') && p.hwnd !== -1);
        if (validWindows.length > 0) {
            const targetWin = validWindows[Math.floor(Math.random() * validWindows.length)];
            cat.vandalTarget = targetWin;
            cat.startJump(targetWin, cat.x + 64, cat.y + 128);
            cat.state = 'VANDAL_JUMP';
            cat.isVandalizing = true;
        } else {
            cat.state = 'CHASE_BUG';
            cat.bugFrames = 0;
            cat.setCatClass('running');
        }
    } else {
        cat.state = 'CHASE_BUG';
        cat.bugFrames = 0;
        cat.setCatClass('running');
    }
    return true;
}

let hoveringGifts = 0;

// Track if ANY cat or gift is hovering so we know whether to ignore mouse events
function updateGlobalHover() {
  if (isDrawingMode || contextMenu.classList.contains('visible') || draggedGift || breakEndTime > Date.now()) {
      ipcRenderer.send('set-ignore-mouse-events', false);
      return;
  }
  const anyHover = cats.some(c => c.isHovering) || hoveringGifts > 0;
  ipcRenderer.send('set-ignore-mouse-events', !anyHover, { forward: true });
}

class Cat {
  constructor(id, isTwin = false, isAutonomous = false) {
    this.id = id;
    this.isTwin = isTwin;
    this.isAutonomous = isAutonomous;
    this.autonomousTargetX = null;
    this.autonomousStateTimeout = 0;
    
    this.x = isTwin ? screenW + 200 : -200;
    this.y = isTwin ? -200 : -200;
    
    this.isBreakMode = false;
    this.breakModeFrames = 0;
    
    this.isVandalizing = false;
    this.vandalTarget = null;
    this.huntingBirdTarget = null;
    
    this.isFetchingGift = false;
    this.giftType = null;
    this.carriedGiftElement = null;
    
    this.isVisible = false;
    this.isHovering = false;
    this.state = 'FALLING';
    this.stateWaitFrames = 0;
    this.platformMoveTimeout = 0;
    this.pounceVx = 0;
    this.pounceVy = 0;
    this.walkVx = 0;
    this.currentPlatform = null;
    
    // Create DOM
    this.container = document.createElement('div');
    this.container.className = 'cat-container';
    if (this.isTwin) this.container.classList.add('twin-cat');
    
    this.balloon = document.createElement('div');
    this.balloon.className = 'cat-speech-balloon';
    
    this.sprite = document.createElement('div');
    this.sprite.className = 'cat-sprite';
    
    this.container.appendChild(this.balloon);
    this.container.appendChild(this.sprite);
    
    this.speechBubble = document.createElement('div');
    this.speechBubble.className = 'speech-bubble';
    this.container.appendChild(this.speechBubble);
    
    document.getElementById('cats-layer').appendChild(this.container);
    
    this.setupListeners();
  }
  
  getEffectiveTargetOffset() {
    const activeCats = cats.filter(c => !c.isLeaving && c.state !== 'FORCED_SIT' && c.state !== 'FORCED_SLEEP');
    if (activeCats.length <= 1) {
      return 0; // If only one cat is awake, it targets the mouse directly
    }
    return this.isTwin ? 60 : -60;
  }
  
  setCatClass(cls) {
    this.container.className = 'cat-container visible ' + cls;
    if (this.isTwin) this.container.classList.add('twin-cat');
    if (this.isBreakMode && this.breakModeFrames > 180) this.container.classList.add('hunting');
    
    if (cls !== 'pounce') {
      this.sprite.style.backgroundPosition = '';
    }
  }
  
  setupListeners() {
    this.sprite.addEventListener('click', (e) => {
      if (!this.isVisible) return;
      if (this.state === 'FORCED_SLEEP' || this.state === 'FORCED_SIT') {
         this.state = 'WAKING_UP';
         this.setCatClass('pounce');
         this.sprite.style.backgroundPosition = `-256px 0px`;
         this.stateWaitFrames = 0;
      }
    });

    this.sprite.addEventListener('contextmenu', (e) => {
      if (!this.isVisible || isDrawingMode) return;
      e.preventDefault();
      e.stopPropagation();
      
      activeContextCat = this;
      
      const menuX = Math.min(screenW - 80, Math.max(80, this.x + 64));
      const menuY = Math.min(screenH - 10, Math.max(260, this.y - 10));
      contextMenu.style.left = `${menuX}px`;
      contextMenu.style.top = `${menuY}px`;
      
      // Update timers
      function formatTimeLeft(lastTime, intervalMin) {
          const timeLeft = (intervalMin * 60 * 1000) - (Date.now() - lastTime);
          if (timeLeft <= 0) return "Soon";
          const min = Math.floor(timeLeft / 60000);
          const sec = Math.floor((timeLeft % 60000) / 1000);
          return `${min}m ${sec}s`;
      }
      
      document.getElementById('menu-timer-eye').textContent = `Eye Rest: ${formatTimeLeft(last20MinTime, 20)}`;
      document.getElementById('menu-timer-short').textContent = `Short Break: ${formatTimeLeft(last30MinTime, 30)}`;
      document.getElementById('menu-timer-long').textContent = `Long Break: ${formatTimeLeft(last90MinTime, 90)}`;
      
      contextMenu.classList.add('visible');
      document.getElementById('menu-overlay').style.display = 'block';
      ipcRenderer.send('set-ignore-mouse-events', false);
    });
  }
  
  startJump(best, cx, cy, forceTargetX = null) {
    this.state = 'JUMPING';
    this.setCatClass('pounce');
    
    let targetX = forceTargetX !== null ? forceTargetX : mouseX + this.getEffectiveTargetOffset();
    if (targetX < best.x + 30) targetX = best.x + 30;
    if (targetX > best.x + best.w - 30) targetX = best.x + best.w - 30;
    
    this.sprite.style.setProperty('--flip-x', targetX > cx ? 1 : -1);
    
    const targetY = best.y;
    
    const jumpDist = Math.abs(targetX - cx);
    const vertDist = cy - targetY;
    
    let time;
    if (vertDist > 0) {
        const minTime = Math.ceil(Math.sqrt(2 * vertDist)) + 2;
        time = Math.max(minTime, Math.floor(Math.min(jumpDist / 15, 40)));
    } else {
        const H = -vertDist;
        const desiredTime = Math.ceil(7 + Math.sqrt(49 + 2 * H));
        const horizTime = Math.floor(Math.min(jumpDist / 20, 18));
        time = Math.max(desiredTime, horizTime);
    }
    
    this.pounceVx = (targetX - cx) / time;
    this.pounceVy = (targetY - cy - 0.5 * 1.0 * time * (time - 1)) / time;
    this.stateWaitFrames = 0;
  }
  
  speak(text, duration = 3000) {
    if (this.speechTimeout) {
      clearTimeout(this.speechTimeout);
    }
    this.speechBubble.textContent = text;
    this.speechBubble.style.opacity = '1';
    
    this.speechTimeout = setTimeout(() => {
      this.speechBubble.style.opacity = '0';
    }, duration);
  }

  show() {
    if (!this.isVisible) {
      this.x = mouseX ? Math.max(100, Math.min(screenW - 100, mouseX)) : screenW / 2;
      this.y = screenH + 10;
      this.pounceVy = -20;
      this.pounceVx = 0;
      this.state = 'RESET_JUMP';
      this.setCatClass('pounce');
      this.stateWaitFrames = 0;
      this.isVisible = true;
    }
  }
  
  update(platforms) {
    if (!this.isVisible) return;
    
    // Check for nearby birds
    const scale = screenW / 3440;
    if (birds.length > 0 && this.state !== 'HUNTING_BIRD' && this.state !== 'JUMPING' && this.state !== 'FALLING') {
        const targetBird = birds.find(b => Math.hypot(b.x - this.x, b.y - this.y) < 1000 * scale && b.state !== 'ESCAPING' && b.state !== 'FLYING');
        if (targetBird && Math.random() < 0.1) {
            this.state = 'HUNTING_BIRD';
            this.huntingBirdTarget = targetBird;
            this.setCatClass('pounce');
        }
    }
    
    // Break Mode Overarching Meta-State Logic
    if (this.isTrueBreakMode) {
      const remainingMs = breakEndTime - Date.now();
      
      if (remainingMs > 0) {
        // Update the speech balloon with the countdown!
        const mins = Math.floor(remainingMs / 60000);
        const secs = Math.floor((remainingMs % 60000) / 1000);
        this.balloon.textContent = `Break! ${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        this.balloon.className = 'cat-speech-balloon';
        if (this.state === 'BREAK_MODE_PRE_JUMP') {
            this.balloon.style.display = 'block';
        } else {
            this.balloon.style.display = 'none';
        }
        
        this.container.classList.remove('hunting'); // Ensure no demonic glow
        
        // Start the break cycle if idle
        if (['ON_PLATFORM', 'EDGE_WAIT', 'SITTING', 'SLEEPING', 'WAKING_UP', 'IDLE'].includes(this.state)) {
           this.state = 'BREAK_MODE_PRE_JUMP';
           this.setCatClass('pounce');
           this.stateWaitFrames = 0;
        }
      }
    } else {
        // Not in break mode, so hide the balloon if it was the break balloon
        if (this.balloon.className.includes('thought-bubble')) {
            this.balloon.style.display = 'none';
            this.balloon.className = 'cat-speech-balloon';
            this.container.classList.remove('hunting');
            if (this.state === 'HUNTING_MOUSE') {
                this.state = 'FALLING';
                this.setCatClass('pounce');
            }
        }
    }
    
    // Hover logic
    const cx = this.x + 64; 
    const cy = this.y + 128; 
    const distToMouse = Math.hypot(mouseX - cx, mouseY - cy);
    const isNowHovering = distToMouse < 64;
    if (this.isHovering !== isNowHovering) {
      this.isHovering = isNowHovering;
      updateGlobalHover();
    }
    
    // Platform move check
    if (this.currentPlatform && this.currentPlatform.hwnd && this.currentPlatform.hwnd !== -1 && !String(this.currentPlatform.hwnd).startsWith('shelf-')) {
      if (['ON_PLATFORM', 'EDGE_WAIT', 'LANDING', 'SLEEPING', 'SITTING', 'WAKING_UP', 'FORCED_SLEEP', 'FORCED_SIT', 'IDLE'].includes(this.state)) {
        const newWin = openWindows.find(w => w.hwnd === this.currentPlatform.hwnd);
        if (newWin) {
          if (this.lastWinX === undefined || this.lastTrackedHwnd !== this.currentPlatform.hwnd) {
             this.lastWinX = newWin.x;
             this.lastWinY = newWin.y;
             this.lastTrackedHwnd = this.currentPlatform.hwnd;
          }
          
          const deltaX = newWin.x - this.lastWinX;
          const deltaY = newWin.y - this.lastWinY;
          
          if (deltaX !== 0 || deltaY !== 0) {
            this.x += deltaX;
            this.y += deltaY;
            this.lastWinX = newWin.x;
            this.lastWinY = newWin.y;
            this.platformMoveTimeout = 10;
            this.container.style.left = `${this.x}px`;
            this.container.style.top = `${this.y}px`;
          }
        } else {
          this.state = 'FALLING';
      this.pounceVy = -15; // Small hop off
      this.walkVx = 0;
      this.setCatClass('pounce');
          this.currentPlatform = null;
          this.lastTrackedHwnd = null;
        }
      }
    }
    
    // Offscreen reset
    if (this.state !== 'RESET_JUMP' && this.state !== 'RUN_AWAY' && this.state !== 'VANDAL_JUMP' && this.state !== 'VANDALIZE_WINDOW' && !this.state.startsWith('FETCH_GIFT_')) {
      if (this.x < -300 || this.x > screenW + 200 || this.y > screenH + 200) {
        if (activeBreakType === 'long') {
            const customPlatforms = loadCustomPlatforms();
            
            if (customPlatforms.length > 0) {
                const targetPlatform = customPlatforms[Math.floor(Math.random() * customPlatforms.length)];
                const targetX = targetPlatform.x + 30 + Math.random() * (targetPlatform.w - 60);
                this.x = targetX - 64;
                this.y = targetPlatform.y - 128; 
                this.state = 'ON_PLATFORM';
                this.currentPlatform = targetPlatform;
                this.setCatClass('idle');
                return;
            }
        }
        
        this.x = Math.max(100, Math.min(screenW - 100, mouseX));
        this.y = screenH + 10;
        this.state = 'RESET_JUMP';
        this.setCatClass('pounce');
        this.pounceVy = -20; 
        this.pounceVx = 0;
        this.stateWaitFrames = 0;
        return;
      }
    }
    
    // Productivity Guard Logic
    if (!this.isBreakMode && !this.isVandalizing && !['VANDAL_JUMP', 'VANDALIZE_WINDOW', 'FALLING', 'RUN_AWAY', 'RESET_JUMP'].includes(this.state) && !this.state.startsWith('FETCH_GIFT_')) {
       let badWindow = null;
       for (let w of openWindows) {
          if (w.hwnd === -1 || String(w.hwnd).startsWith('shelf-')) continue;
          const title = w.title.toLowerCase();
          if (distractingKeywords.some(k => title.includes(k))) {
             badWindow = w;
             break;
          }
       }
       if (badWindow) {
          this.vandalTarget = badWindow;
          this.isVandalizing = true;
          this.state = 'VANDAL_JUMP';
          this.setCatClass('pounce');
          this.sprite.style.backgroundPosition = `-256px 0px`;
          
          const cx = this.x + 64;
          const cy = this.y + 128;
          // Jump to the left edge of the bad window
          const targetX = badWindow.x + 40; 
          const targetY = badWindow.y;
          
          const dx = targetX - cx;
          const dy = targetY - cy;
          
          let time = 40;
          if (dy < 0) {
              const H = -dy;
              const desiredTime = Math.ceil(7 + Math.sqrt(49 + 2 * H));
              time = Math.max(desiredTime, 15);
          }
          
          this.pounceVx = dx / time;
          this.pounceVy = (dy - 0.5 * 1.0 * time * (time - 1)) / time;
          
          this.balloon.textContent = "No distractions, human!";
          this.balloon.style.display = "block";
          this.container.classList.add('hunting'); // Red eyes for anger
       }
    }
    
    // State Machine
    if (this.state === 'VANDAL_JUMP') {
        this.x += this.pounceVx;
        this.y += this.pounceVy;
        this.pounceVy += 1.0;
        this.sprite.style.setProperty('--flip-x', this.pounceVx > 0 ? 1 : -1);
        
        if (this.y + 128 >= this.vandalTarget.y && this.pounceVy > 0) {
           this.y = this.vandalTarget.y - 128;
           this.state = 'VANDALIZE_WINDOW';
           this.vandalFrames = 0;
           this.setCatClass('attack');
           this.sprite.style.setProperty('--flip-x', 1);
        }
        
        this.container.style.left = `${this.x}px`;
        this.container.style.top = `${this.y}px`;
        return;
    }
    
    if (this.state === 'VANDALIZE_WINDOW') {
        const currentWindow = openWindows.find(w => w.hwnd === this.vandalTarget.hwnd);
        const stillDistracting = currentWindow && distractingKeywords.some(k => currentWindow.title.toLowerCase().includes(k));
        
        if (!stillDistracting) {
            this.isVandalizing = false;
            this.vandalTarget = null;
            this.pounceVx = 0;
            this.pounceVy = 0;
            this.container.classList.remove('hunting');
            this.balloon.style.display = "none";
            document.querySelectorAll('.scratch-mark').forEach(s => s.remove());
            
            if (currentWindow) {
                // Window still exists, just no longer distracting (tab switched)
                this.currentPlatform = currentWindow;
                this.state = 'ON_PLATFORM';
                this.setCatClass('idle');
            } else {
                // Window was completely closed
                this.state = 'FALLING';
                this.setCatClass('pounce');
            }
        } else {
            this.vandalFrames++;
            
            const minX = this.vandalTarget.x;
            const maxX = this.vandalTarget.x + this.vandalTarget.w - 128;
            
            if (this.vandalFrames % 40 < 20) {
               this.x += 15;
               this.sprite.style.setProperty('--flip-x', 1);
            } else {
               this.x -= 15;
               this.sprite.style.setProperty('--flip-x', -1);
            }
            
            if (this.x < minX) this.x = minX;
            if (this.x > maxX) this.x = maxX;
            
            if (this.vandalFrames % 6 === 0) {
               const scratch = document.createElement('div');
               scratch.className = 'scratch-mark';
               
               const sx = this.vandalTarget.x + Math.random() * Math.max(0, this.vandalTarget.w - 150);
               const sy = this.vandalTarget.y + Math.random() * Math.max(0, this.vandalTarget.h - 150);
               
               scratch.style.left = `${sx}px`;
               scratch.style.top = `${sy}px`;
               scratch.style.transform = `rotate(${Math.random() * 360}deg)`;
               
               document.body.appendChild(scratch);
            }
        }
        
        this.container.style.left = `${this.x}px`;
        this.container.style.top = `${this.y}px`;
        return;
    }
    
    if (this.state === 'CHASE_BUG') {
        this.bugFrames++;
        
        if (this.bugFrames % 60 === 0 && Math.random() < 0.3) {
            const currentFlip = parseInt(this.sprite.style.getPropertyValue('--flip-x')) || 1;
            this.sprite.style.setProperty('--flip-x', -currentFlip);
        }
        
        if (this.bugFrames % 90 === 0 && Math.random() < 0.4 && this.currentPlatform) {
            this.pounceVy = -15;
            this.state = 'BUG_JUMP';
            this.setCatClass('pounce');
        }
        
        const dir = parseInt(this.sprite.style.getPropertyValue('--flip-x')) || 1;
        this.x += dir * 15;
        
        if (this.currentPlatform) {
            const currentSplit = platforms.find(p => p.hwnd === this.currentPlatform.hwnd && this.x + 64 >= p.x && this.x + 64 <= p.x + p.w);
            if (!currentSplit) {
                this.currentPlatform = null;
                this.pounceVy = 0;
                this.setCatClass('pounce');
            } else {
                this.currentPlatform = currentSplit;
                this.y = this.currentPlatform.y - 128;
                this.setCatClass('running');
            }
        }
        
        if (!this.currentPlatform) {
            const oldCy = this.y + 128;
            this.pounceVy += 1.0;
            if (this.pounceVy > 25) this.pounceVy = 25;
            this.y += this.pounceVy;
            this.sprite.style.backgroundPosition = `-768px 0px`;
            
            const hit = checkCollision(this.x + 64, this.y + 128, oldCy, null, platforms);
            if (hit && this.pounceVy > 0) {
                this.y = hit.y - 128;
                this.currentPlatform = hit;
                this.pounceVy = 0;
                this.setCatClass('running');
            }
        }
        
        if (this.x < 0) {
            this.x = 0;
            this.sprite.style.setProperty('--flip-x', 1);
        } else if (this.x > screenW - 128) {
            this.x = screenW - 128;
            this.sprite.style.setProperty('--flip-x', -1);
        }
        
        if (this.bugFrames > 300) {
            this.state = 'FALLING';
            this.pounceVx = 0;
            this.pounceVy = 0;
            this.setCatClass('pounce');
        }
        this.container.style.left = `${this.x}px`;
        this.container.style.top = `${this.y}px`;
        return;
    }
    
    if (this.state === 'BUG_JUMP') {
        const oldCy = this.y + 128;
        const dir = parseInt(this.sprite.style.getPropertyValue('--flip-x')) || 1;
        this.x += dir * 15;
        this.y += this.pounceVy;
        this.pounceVy += 1.0;
        if (this.pounceVy > 25) this.pounceVy = 25;
        this.sprite.style.backgroundPosition = `-768px 0px`;
        
        const hit = checkCollision(this.x + 64, this.y + 128, oldCy, null, platforms);
        if (hit && this.pounceVy > 0) {
            this.y = hit.y - 128;
            this.currentPlatform = hit;
            this.state = 'CHASE_BUG';
            this.setCatClass('running');
        }
        
        if (this.x < 0) {
            this.x = 0;
            this.sprite.style.setProperty('--flip-x', 1);
        } else if (this.x > screenW - 128) {
            this.x = screenW - 128;
            this.sprite.style.setProperty('--flip-x', -1);
        }
        
        this.container.style.left = `${this.x}px`;
        this.container.style.top = `${this.y}px`;
        return;
    }
    
    if (this.state === 'FETCH_GIFT_WALK_OFF') {
        const dir = this.pounceVx > 0 ? 1 : -1;
        this.sprite.style.setProperty('--flip-x', dir);
        this.x += this.pounceVx;
        
        if (this.currentPlatform) {
            const currentSplit = platforms.find(p => p.hwnd === this.currentPlatform.hwnd && this.x + 64 >= p.x && this.x + 64 <= p.x + p.w);
            if (!currentSplit) {
                this.currentPlatform = null;
                this.pounceVy = 0;
                this.setCatClass('pounce');
            } else {
                this.currentPlatform = currentSplit;
                this.y = this.currentPlatform.y - 128;
                this.setCatClass('running');
            }
        }
        
        if (!this.currentPlatform) {
            const oldCy = this.y + 128;
            this.pounceVy += 1.0;
            if (this.pounceVy > 25) this.pounceVy = 25;
            this.y += this.pounceVy;
            this.sprite.style.backgroundPosition = `-768px 0px`;
            
            const hit = checkCollision(this.x + 64, this.y + 128, oldCy, null, platforms);
            if (hit && this.pounceVy > 0) {
                this.y = hit.y - 128;
                this.currentPlatform = hit;
                this.pounceVy = 0;
                this.setCatClass('running');
            }
        }
        
        if (this.x < -300 || this.x > screenW + 200) {
            // Reached off screen. Create the carried gift element.
            this.carriedGiftElement = document.createElement('div');
            this.carriedGiftElement.className = `cat-gift gift-${this.giftType}`;
            
            this.carriedGiftElement.addEventListener('mousedown', (e) => {
                 const g = placedGifts.find(pg => pg.el === e.target);
                 if (g) {
                     draggedGift = g;
                     draggedGift.isFalling = false;
                     draggedGift.hwnd = -1;
                     draggedGift.el.style.pointerEvents = 'none';
                     lastGiftMouseX = e.clientX;
                     lastGiftMouseY = e.clientY;
                     updateGlobalHover();
                 }
            });
            
            this.carriedGiftElement.addEventListener('mouseenter', () => {
                hoveringGifts++;
                updateGlobalHover();
            });
            
            this.carriedGiftElement.addEventListener('mouseleave', () => {
                hoveringGifts--;
                updateGlobalHover();
            });

            if (this.giftBgPos) {
               this.carriedGiftElement.style.backgroundPosition = this.giftBgPos;
            }
            document.body.appendChild(this.carriedGiftElement);
            
            this.pounceVx *= -1; // Turn around
            this.state = 'FETCH_GIFT_WALK_ON';
        }
        this.container.style.left = `${this.x}px`;
        this.container.style.top = `${this.y}px`;
        return;
    }
    
    if (this.state === 'FETCH_GIFT_WALK_ON') {
        const dir = this.pounceVx > 0 ? 1 : -1;
        this.sprite.style.setProperty('--flip-x', dir);
        this.x += this.pounceVx;
        
        if (this.currentPlatform) {
            const currentSplit = platforms.find(p => p.hwnd === this.currentPlatform.hwnd && this.x + 64 >= p.x && this.x + 64 <= p.x + p.w);
            if (!currentSplit) {
                this.currentPlatform = null;
                this.pounceVy = 0;
                this.setCatClass('pounce');
            } else {
                this.currentPlatform = currentSplit;
                this.y = this.currentPlatform.y - 128;
                this.setCatClass('running');
            }
        }
        
        if (!this.currentPlatform) {
            const oldCy = this.y + 128;
            this.pounceVy += 1.0;
            if (this.pounceVy > 25) this.pounceVy = 25;
            this.y += this.pounceVy;
            this.sprite.style.backgroundPosition = `-768px 0px`;
            
            const hit = checkCollision(this.x + 64, this.y + 128, oldCy, null, platforms);
            if (hit && this.pounceVy > 0) {
                this.y = hit.y - 128;
                this.currentPlatform = hit;
                this.pounceVy = 0;
                this.setCatClass('running');
            }
        }
        
        // Render carried gift in mouth
        this.carriedGiftElement.style.left = `${this.x + 64 + dir * 40}px`;
        this.carriedGiftElement.style.top = `${this.y + 100}px`;
        
        if ((dir > 0 && this.x > 50) || (dir < 0 && this.x < screenW - 178)) {
            const validTargets = platforms.filter(p => !String(p.hwnd).startsWith('shelf-') && p.hwnd !== -1 && p.y > -20 && p.w > 64);
            const targetWin = validTargets.length > 0 ? validTargets[Math.floor(Math.random() * validTargets.length)] : null;
            
            if (targetWin) {
                this.vandalTarget = targetWin;
                this.startJump(targetWin, this.x + 64, this.y + 128);
                this.state = 'FETCH_GIFT_JUMP';
            } else {
                // No window found. Just drop it!
                this.isFetchingGift = false;
                placedGifts.push({ el: this.carriedGiftElement, hwnd: -1, offsetX: 0, offsetY: 0, x: this.x + 64 + dir * 40, y: this.y + 100, isFalling: true, vx: 0, vy: 0 });
                this.carriedGiftElement = null;
                this.state = 'FALLING';
                this.pounceVx = 0;
                this.pounceVy = 0;
                this.setCatClass('pounce');
                this.currentPlatform = null;
            }
        }
        this.container.style.left = `${this.x}px`;
        this.container.style.top = `${this.y}px`;
        return;
    }
    
    if (this.state === 'FETCH_GIFT_JUMP') {
        const dir = this.pounceVx > 0 ? 1 : -1;
        this.x += this.pounceVx;
        this.y += this.pounceVy;
        this.pounceVy += 1.0;
        this.sprite.style.setProperty('--flip-x', dir);
        
        // Render carried gift in mouth
        this.carriedGiftElement.style.left = `${this.x + 64 + dir * 40}px`;
        this.carriedGiftElement.style.top = `${this.y + 100}px`;
        
        if (this.y + 128 >= this.vandalTarget.y && this.pounceVy > 0) {
            this.y = this.vandalTarget.y - 128;
            this.state = 'FETCH_GIFT_PLACE';
            this.vandalFrames = 0;
            this.setCatClass('running');
            // Choose a random spot on the window to place it
            this.pounceVx = Math.random() > 0.5 ? 8 : -8;
            this.dropTargetX = this.vandalTarget.x + 50 + Math.random() * (this.vandalTarget.w - 100);
        }
        this.container.style.left = `${this.x}px`;
        this.container.style.top = `${this.y}px`;
        return;
    }
    
    if (this.state === 'FETCH_GIFT_PLACE') {
        const currentWindow = openWindows.find(w => w.hwnd === this.vandalTarget.hwnd);
        if (!currentWindow) {
            // Window closed while running to place it!
            this.isFetchingGift = false;
            placedGifts.push({ el: this.carriedGiftElement, hwnd: -1, offsetX: 0, offsetY: 0, x: this.x + 64, y: this.y + 100, isFalling: true, vx: 0, vy: 0 });
            this.carriedGiftElement = null;
            this.state = 'FALLING';
            this.pounceVx = 0;
            this.pounceVy = 0;
            this.setCatClass('pounce');
            return;
        }
        
        // Update local vandalTarget reference in case window moved
        this.vandalTarget = currentWindow;
        this.y = currentWindow.y - 128; // Stick to top
        
        const cx = this.x + 64;
        const dir = cx < this.dropTargetX ? 1 : -1;
        this.x += dir * 8;
        this.sprite.style.setProperty('--flip-x', dir);
        
        this.carriedGiftElement.style.left = `${this.x + 64 + dir * 40}px`;
        this.carriedGiftElement.style.top = `${this.y + 100}px`;
        
        if (Math.abs(cx - this.dropTargetX) < 15) {
            // Placed!
            this.isFetchingGift = false;
            const finalOffsetX = (this.x + 64 + dir * 40) - currentWindow.x;
            
            placedGifts.push({ el: this.carriedGiftElement, hwnd: currentWindow.hwnd, offsetX: finalOffsetX, offsetY: -32, x: 0, y: 0, isFalling: false, vx: 0, vy: 0 });
            this.carriedGiftElement.style.pointerEvents = 'auto';
            this.carriedGiftElement = null;
            
            const phrases = [
                "I caught this for you!",
                "Thought you might need this.",
                "Here you go!",
                "Meow! A gift!",
                "Just for you!"
            ];
            this.speak(phrases[Math.floor(Math.random() * phrases.length)]);
            
            this.currentPlatform = currentWindow;
            this.state = 'FETCH_GIFT_WAIT';
            this.stateWaitFrames = 0;
            this.setCatClass('pounce');
            this.sprite.style.backgroundPosition = `-128px 0px`;
            this.pounceVx = 0;
            this.pounceVy = 0;
        }
        this.container.style.left = `${this.x}px`;
        this.container.style.top = `${this.y}px`;
        return;
    }

    if (this.state === 'RUN_AWAY') {
       const dir = (this.x < screenW / 2) ? -1 : 1;
       this.sprite.style.setProperty('--flip-x', dir);
       
       const cx = this.x + 64;
       
       if (this.currentPlatform) {
          this.x += dir * 12;
          this.setCatClass('running');
          
          if (cx < this.currentPlatform.x || cx > this.currentPlatform.x + this.currentPlatform.w) {
             this.currentPlatform = null;
             this.pounceVy = -12; // Give it a nice upward leap off the edge instead of just dropping!
          }
       } else {
          // Play the jump animation frame (frame index 2 is the mid-air stretch)
          this.setCatClass('pounce');
          this.sprite.style.backgroundPosition = `-256px 0px`;
          
          this.x += dir * 10; // Keep strong horizontal momentum during the jump
          
          const oldCy = this.y + 128;
          this.pounceVy += 1.0;
          if (this.pounceVy > 25) this.pounceVy = 25;
          this.y += this.pounceVy;
          
          const hit = checkCollision(this.x + 64, this.y + 128, oldCy, null, platforms);
          if (hit && this.pounceVy > 0) {
             this.y = hit.y - 128;
             this.currentPlatform = hit;
             this.pounceVy = 0;
          }
       }
       
       if (this.x < -300 || this.x > screenW + 200) {
          this.container.remove();
          const idx = cats.indexOf(this);
          if (idx > -1) cats.splice(idx, 1);
       }
       
       this.container.style.left = `${this.x}px`;
       this.container.style.top = `${this.y}px`;
       return;
    }
    
    if (this.state === 'FALLING') {
      const oldCy = this.y + 128;
      this.pounceVy += 1.0;
      if (this.pounceVy > 25) this.pounceVy = 25;
      
      this.x += this.pounceVx;
      if (this.pounceVx > 0) {
         this.pounceVx -= 0.5;
         if (this.pounceVx < 0) this.pounceVx = 0;
      } else if (this.pounceVx < 0) {
         this.pounceVx += 0.5;
         if (this.pounceVx > 0) this.pounceVx = 0;
      }
      
      this.y += this.pounceVy;
      
      this.sprite.style.backgroundPosition = `-768px 0px`;
      
      const hit = checkCollision(this.x + 64, this.y + 128, oldCy, null, platforms);
      if (hit && this.pounceVy > 0) {
        this.y = hit.y - 128; 
        this.currentPlatform = hit;
        this.pounceVy = 0;
        
        if (this.isEyeBreakFalling) {
            this.state = 'FORCED_SLEEP';
            this.setCatClass('sleep');
            this.isEyeBreakFalling = false;
            this.isEyeBreakSleeping = true;
            
            if (!window.purrAudio) {
                window.purrAudio = new Audio('sound_effects/cat_pur.mp3');
                window.purrAudio.loop = true;
            }
            window.purrAudio.volume = 0;
            window.purrAudio.play().catch(e => console.log(e));
            
            let fadeVol = 0;
            let fadeIn = setInterval(() => {
                fadeVol += 0.05;
                if (fadeVol >= 1) {
                    window.purrAudio.volume = 1;
                    clearInterval(fadeIn);
                } else {
                    window.purrAudio.volume = fadeVol;
                }
            }, 100);
        } else {
            this.state = 'LANDING';
            this.setCatClass('pounce');
            this.stateWaitFrames = 0;
        }
      }
    } 
    else if (this.state === 'LANDING') {
      this.stateWaitFrames++;
      let animFrame = Math.floor(this.stateWaitFrames / 2);
      let frameIndex = 6 + animFrame;
      if (frameIndex > 12) {
        this.state = 'ON_PLATFORM';
        this.setCatClass('idle');
        this.stateWaitFrames = 0;
      } else {
        this.sprite.style.backgroundPosition = `-${frameIndex * 128}px 0px`;
      }
    }
    else if (this.state === 'EDGE_WAIT') {
      if (this.platformMoveTimeout > 0) {
        this.platformMoveTimeout--;
        this.setCatClass('pounce');
        this.sprite.style.backgroundPosition = `-128px 0px`;
      } else {
        this.stateWaitFrames++;
        this.sprite.style.backgroundPosition = `-128px 0px`;
        
        const currentSplit = platforms.find(p => p.hwnd === this.currentPlatform.hwnd && cx >= p.x && cx <= p.x + p.w);
        if (!currentSplit) {
           this.state = 'FALLING';
           this.pounceVy = 0;
           this.walkVx = 0;
           this.setCatClass('pounce');
           this.currentPlatform = null;
           return;
        }
        this.currentPlatform = currentSplit;
      
        if (cx <= this.currentPlatform.x + 5) {
          this.sprite.style.setProperty('--flip-x', -1);
        } else if (cx >= this.currentPlatform.x + this.currentPlatform.w - 5) {
          this.sprite.style.setProperty('--flip-x', 1);
        } else {
          const targetX = mouseX + this.getEffectiveTargetOffset();
          this.sprite.style.setProperty('--flip-x', targetX > cx ? 1 : -1);
        }
        
        if (this.stateWaitFrames > 60) {
          const distToMouse = Math.hypot(mouseX - cx, mouseY - cy);
          if (!this.isAutonomous && distToMouse < 100) {
             this.state = 'ON_PLATFORM';
             this.setCatClass('sit');
             if (cx <= this.currentPlatform.x + 5) this.x += 10;
             else if (cx >= this.currentPlatform.x + this.currentPlatform.w - 5) this.x -= 10;
             return;
          }
          
          if (this.isAutonomous) {
              const validPlatforms = platforms.filter(p => {
                  if (p.hwnd === this.currentPlatform.hwnd || p.hwnd === -1 || String(p.hwnd).startsWith('line-')) return false;
                  const px = p.x + p.w / 2;
                  return Math.hypot(px - cx, p.y - cy) < 600; // Limit jumps to 600px radius
              });
              if (validPlatforms.length > 0 && Math.random() < 0.7) {
                  const best = validPlatforms[Math.floor(Math.random() * validPlatforms.length)];
                  const targetX = best.x + 30 + Math.random() * (best.w - 60);
                  this.startJump(best, cx, cy, targetX);
              } else {
                  this.state = 'ON_PLATFORM';
                  this.setCatClass('idle');
                  if (cx <= this.currentPlatform.x + 5) this.x += 10;
                  else if (cx >= this.currentPlatform.x + this.currentPlatform.w - 5) this.x -= 10;
                  this.autonomousStateTimeout = 60 + Math.random() * 120;
              }
              return;
          }
          
          let best = null;
          let bestDist = Infinity;
          for (let p of platforms) {
            const px = p.x + p.w / 2;
            const py = p.y;
            const dist = Math.hypot(px - (mouseX + this.getEffectiveTargetOffset()), py - mouseY);
            if (dist < bestDist) {
              bestDist = dist;
              best = p;
            }
          }
          
          if (best && (!this.currentPlatform || best.x !== this.currentPlatform.x || best.y !== this.currentPlatform.y)) {
            this.startJump(best, cx, cy);
          } else {
            if (this.x + 64 <= this.currentPlatform.x) this.x -= 2;
            else this.x += 2;
            this.state = 'FALLING';
            this.pounceVy = 0;
            this.walkVx = 0;
            this.setCatClass('pounce');
            this.stateWaitFrames = 0;
          }
        }
      }
    }
    else if (this.state === 'ON_PLATFORM') {
      if (this.platformMoveTimeout > 0) {
        this.platformMoveTimeout--;
        this.setCatClass('pounce');
        this.sprite.style.backgroundPosition = `-128px 0px`;
      } else {
        const currentSplit = platforms.find(p => p.hwnd === this.currentPlatform.hwnd && cx >= p.x && cx <= p.x + p.w);
        if (!currentSplit) {
           this.state = 'FALLING';
           this.pounceVy = 0;
           this.setCatClass('pounce');
           this.currentPlatform = null;
           return;
        }
        this.currentPlatform = currentSplit;
  
        if (cx < this.currentPlatform.x || cx > this.currentPlatform.x + this.currentPlatform.w) {
          if (cx < this.currentPlatform.x) this.x = this.currentPlatform.x - 64;
          else this.x = this.currentPlatform.x + this.currentPlatform.w - 64;
          
          this.state = 'EDGE_WAIT';
          this.stateWaitFrames = 0;
          this.setCatClass('pounce');
          this.sprite.style.backgroundPosition = `-128px 0px`;
          return;
        }
        
        if (this.isAutonomous) {
            this.autonomousStateTimeout--;
            if (this.autonomousStateTimeout <= 0) {
               const rand = Math.random();
               if (rand < 0.2) {
                  this.state = 'SITTING';
                  this.setCatClass('sit');
                  this.autonomousStateTimeout = 180 + Math.random() * 300;
               } else if (rand < 0.4) {
                  this.state = 'SLEEPING';
                  this.setCatClass('sleep');
                  this.autonomousStateTimeout = 300 + Math.random() * 500;
               } else if (rand < 0.6) {
                   const validPlatforms = platforms.filter(p => {
                       if (p.hwnd === this.currentPlatform.hwnd || p.hwnd === -1 || String(p.hwnd).startsWith('line-')) return false;
                       const px = p.x + p.w / 2;
                       return Math.hypot(px - cx, p.y - cy) < 800; // Limit jumps to 800px radius
                   });
                   if (validPlatforms.length > 0) {
                       const targetPlatform = validPlatforms[Math.floor(Math.random() * validPlatforms.length)];
                       const targetX = targetPlatform.x + 30 + Math.random() * (targetPlatform.w - 60);
                       this.startJump(targetPlatform, cx, cy, targetX);
                       return;
                   } else {
                       this.autonomousTargetX = this.currentPlatform.x + 30 + Math.random() * (this.currentPlatform.w - 60);
                       this.state = 'AUTONOMOUS_WALK';
                       this.setCatClass('running');
                   }
               } else {
                  this.autonomousTargetX = this.currentPlatform.x + 30 + Math.random() * (this.currentPlatform.w - 60);
                  this.state = 'AUTONOMOUS_WALK';
                  this.setCatClass('running');
               }
            }
            return;
        }
        
        const effectiveOffset = this.getEffectiveTargetOffset();
        let dx = (mouseX + effectiveOffset) - cx;
        const actualDx = mouseX - cx;
        
        const distToMouse = Math.hypot(mouseX - cx, mouseY - cy);
        const mouseRadius = 300 * (screenW / 3440);
        if (distToMouse < mouseRadius) {
            dx = 0;
        }
        
        // Prevent the cat from running away from the cursor when you try to click it
        if (Math.sign(dx) !== Math.sign(actualDx) && Math.abs(actualDx) <= Math.abs(effectiveOffset) + 10) {
            dx = 0;
        }
        
        const dir = Math.sign(dx) || 1;
        
        // Only start chasing if the target is a reasonable distance away
        if (Math.abs(dx) > 30) {
          let targetSpeed = 8;
          if (distToMouse < mouseRadius + 300) {
              targetSpeed = Math.max(2, 8 * ((distToMouse - mouseRadius) / 300));
          }
          
          const desiredVx = targetSpeed * dir;
          this.walkVx += (desiredVx - this.walkVx) * 0.1; // Smooth acceleration
          
          this.x += this.walkVx;
          this.sprite.style.setProperty('--flip-x', this.walkVx > 0 ? 1 : -1);
          this.setCatClass('running');
          
          const speedRatio = Math.max(0.3, Math.abs(this.walkVx) / 8);
          this.sprite.style.animationDuration = `${0.5 / speedRatio}s`;
        } else {
          this.walkVx += (0 - this.walkVx) * 0.2; // Smooth deceleration
          this.x += this.walkVx;
          
          if (Math.abs(this.walkVx) < 0.5) {
              this.walkVx = 0;
              this.sprite.style.animationDuration = '0.5s';
              this.sprite.style.setProperty('--flip-x', Math.sign(actualDx) || 1);
              
              if (mouseIdleFrames > 600) {
                this.state = 'SLEEPING';
                this.setCatClass('sleep');
              } else if (mouseIdleFrames > 300) {
                this.state = 'SITTING';
                this.setCatClass('sit');
              } else {
                this.setCatClass('idle');
              }
          } else {
              this.setCatClass('running');
              const speedRatio = Math.max(0.3, Math.abs(this.walkVx) / 8);
              this.sprite.style.animationDuration = `${0.5 / speedRatio}s`;
          }
        }
        
        this.stateWaitFrames++;
        
        const fallingGift = placedGifts.find(g => g.isFalling && g.wasThrown && g.y < screenH - 64 && g.y > 0);
        if (fallingGift && Math.random() < 0.1) {
            this.vandalTarget = fallingGift;
            this.state = 'FETCH_THROWN_GIFT';
            this.setCatClass('pounce');
            this.stateWaitFrames = 0;
            this.speak("Mine!");
            return;
        }
        
        if (this.stateWaitFrames > 30 && this.state === 'ON_PLATFORM') {
           if (Math.random() < 0.01) {
                const targetGift = placedGifts.find(g => g.hwnd === this.currentPlatform.hwnd && !g.isFalling);
                if (targetGift) {
                    this.vandalTarget = targetGift;
                    this.state = 'SWAT_GIFT_WALK';
                    this.setCatClass('running');
                    this.stateWaitFrames = 0;
                    return;
                }
           }
           
          let best = null;
          let bestDist = Infinity;
          for (let p of platforms) {
            const px = p.x + p.w / 2;
            const py = p.y;
            const dist = Math.hypot(px - (mouseX + this.getEffectiveTargetOffset()), py - mouseY);
            if (dist < bestDist) {
              bestDist = dist;
              best = p;
            }
          }
          
          if (best && (!this.currentPlatform || best.x !== this.currentPlatform.x || best.y !== this.currentPlatform.y)) {
            // Hesitate before jumping down to ANY lower platform
            if (best.y > this.currentPlatform.y) {
               this.state = 'EDGE_WAIT';
               this.stateWaitFrames = 0;
               this.setCatClass('pounce');
               this.sprite.style.backgroundPosition = `-128px 0px`;
            } else {
               this.startJump(best, cx, cy);
            }
          }
        }
      }
    }
    else if (this.state === 'AUTONOMOUS_WALK') {
       const cx = this.x + 64;
       const currentSplit = platforms.find(p => p.hwnd === this.currentPlatform.hwnd && cx >= p.x && cx <= p.x + p.w);
       if (!currentSplit) {
           this.state = 'FALLING';
           this.pounceVy = 0;
           this.setCatClass('pounce');
           this.currentPlatform = null;
           return;
       }
       this.currentPlatform = currentSplit;
       
       let dx = this.autonomousTargetX - cx;
       const dir = Math.sign(dx) || 1;
       
       if (Math.abs(dx) > 10) {
           const desiredVx = 4 * dir;
           this.walkVx += (desiredVx - this.walkVx) * 0.1;
           this.x += this.walkVx;
           this.sprite.style.setProperty('--flip-x', this.walkVx > 0 ? 1 : -1);
           this.setCatClass('running');
           
           const speedRatio = Math.max(0.3, Math.abs(this.walkVx) / 4);
           this.sprite.style.animationDuration = `${0.6 / speedRatio}s`;
       } else {
           this.walkVx += (0 - this.walkVx) * 0.2;
           this.x += this.walkVx;
           
           if (Math.abs(this.walkVx) < 0.5) {
               this.walkVx = 0;
               this.sprite.style.animationDuration = '0.8s';
               this.state = 'ON_PLATFORM';
               this.setCatClass('idle');
               this.autonomousStateTimeout = 60 + Math.random() * 120;
           } else {
               this.setCatClass('running');
           }
       }
    }
    else if (['SITTING', 'SLEEPING', 'FORCED_SLEEP', 'FORCED_SIT'].includes(this.state)) {
       const fallingGift = placedGifts.find(g => g.isFalling && g.wasThrown && g.y < screenH - 64 && g.y > 0);
       if (fallingGift && Math.random() < 0.2) {
           this.vandalTarget = fallingGift;
           this.state = 'FETCH_THROWN_GIFT';
           this.setCatClass('pounce');
           this.stateWaitFrames = 0;
           this.speak("Mine!");
           return;
       }
       
       this.stateWaitFrames++;
       
       if (this.isAutonomous) {
          this.autonomousStateTimeout--;
          if (this.autonomousStateTimeout <= 0) {
              this.state = 'WAKING_UP';
              this.setCatClass('pounce');
              this.sprite.style.backgroundPosition = `-256px 0px`;
              this.stateWaitFrames = 0;
          }
       } else {
         const effectiveOffset = this.getEffectiveTargetOffset();
         if (Math.abs((mouseX + effectiveOffset) - (this.x + 64)) > 150) {
           this.state = 'WAKING_UP';
           this.setCatClass('pounce');
           this.sprite.style.backgroundPosition = `-256px 0px`;
           this.stateWaitFrames = 0;
         }
       }
     }
     else if (this.state === 'HUNTING_BIRD') {
         if (!this.huntingBirdTarget || birds.indexOf(this.huntingBirdTarget) === -1 || this.huntingBirdTarget.state === 'ESCAPING') {
             this.state = 'EDGE_WAIT';
             this.stateWaitFrames = 0;
             this.huntingBirdTarget = null;
             this.setCatClass('idle');
             return;
         }
         
         const targetX = this.huntingBirdTarget.x;
         const cx = this.x + 64;
         const cy = this.y + 128;
         
         const currentSplit = platforms.find(p => p.hwnd === this.currentPlatform?.hwnd && cx >= p.x && cx <= p.x + p.w);
         if (currentSplit && this.huntingBirdTarget.currentPlatform) {
             if (this.huntingBirdTarget.currentPlatform.hwnd === currentSplit.hwnd) {
                 // Same platform, sprint at the bird!
                 const dx = targetX - cx;
                 const dir = Math.sign(dx) || 1;
                 if (Math.abs(dx) > 10) {
                     this.walkVx += (8 * dir - this.walkVx) * 0.1;
                     
                     let newX = this.x + this.walkVx;
                     if (newX + 64 < currentSplit.x) {
                         newX = currentSplit.x - 64;
                         this.walkVx = 0;
                     } else if (newX + 64 > currentSplit.x + currentSplit.w) {
                         newX = currentSplit.x + currentSplit.w - 64;
                         this.walkVx = 0;
                     }
                     this.x = newX;
                     
                     this.sprite.style.setProperty('--flip-x', this.walkVx > 0 ? 1 : -1);
                     this.setCatClass('running');
                     
                     const speedRatio = Math.max(0.3, Math.abs(this.walkVx) / 8);
                     this.sprite.style.animationDuration = `${0.5 / speedRatio}s`;
                 }
             } else {
                 // Different platform, jump to the bird's platform!
                 const scale = screenW / 3440;
                 const dist = Math.hypot(targetX - cx, this.huntingBirdTarget.currentPlatform.y - cy);
                 if (dist > 800 * scale) {
                     this.state = 'EDGE_WAIT';
                     this.stateWaitFrames = 0;
                     this.huntingBirdTarget = null;
                     this.setCatClass('idle');
                 } else {
                     this.startJump(this.huntingBirdTarget.currentPlatform, cx, cy, targetX);
                 }
             }
         } else if (!currentSplit) {
             this.state = 'FALLING';
             this.setCatClass('pounce');
             this.currentPlatform = null;
         }
     }
    else if (this.state === 'WAKING_UP') {
      if (this.platformMoveTimeout > 0) {
        this.platformMoveTimeout--;
        this.state = 'ON_PLATFORM';
        this.setCatClass('pounce');
        this.sprite.style.backgroundPosition = `-128px 0px`;
      } else {
        this.stateWaitFrames++;
        if (this.stateWaitFrames <= 60) {
          this.sprite.style.backgroundPosition = `-256px 0px`;
        } else if (this.stateWaitFrames <= 75) {
          this.sprite.style.backgroundPosition = `-128px 0px`;
        } else if (this.stateWaitFrames <= 90) {
          this.sprite.style.backgroundPosition = `0px 0px`;
        } else {
          this.state = 'ON_PLATFORM';
          this.setCatClass('idle');
          this.stateWaitFrames = 0;
        }
      }
    }
    else if (this.state === 'FETCH_GIFT_WAIT') {
       this.stateWaitFrames++;
       if (this.stateWaitFrames > 60) {
           this.state = 'ON_PLATFORM';
           this.setCatClass('idle');
           this.stateWaitFrames = 0;
       }
    }
    else if (this.state === 'SWAT_GIFT_WALK') {
       if (!this.vandalTarget || this.vandalTarget.isFalling || !placedGifts.includes(this.vandalTarget)) {
           this.state = 'ON_PLATFORM';
           return;
       }
       
       const gx = this.vandalTarget.x;
       const cx = this.x + 64;
       const dx = gx - cx;
       const dir = Math.sign(dx) || 1;
       
       if (Math.abs(dx) < 20) {
           this.state = 'SWAT_GIFT';
           this.setCatClass('pounce');
           this.sprite.style.backgroundPosition = `-128px 0px`;
           this.stateWaitFrames = 0;
           this.sprite.style.setProperty('--flip-x', dir);
           return;
       }
       
       this.x += dir * 4;
       this.sprite.style.setProperty('--flip-x', dir);
    }
    else if (this.state === 'SWAT_GIFT') {
       this.stateWaitFrames++;
       if (this.stateWaitFrames > 30) {
           if (this.vandalTarget && !this.vandalTarget.isFalling && placedGifts.includes(this.vandalTarget)) {
               this.vandalTarget.isFalling = true;
               this.vandalTarget.hwnd = -1;
               this.vandalTarget.ignoreHwnd = this.currentPlatform ? this.currentPlatform.hwnd : null;
               const dir = parseInt(this.sprite.style.getPropertyValue('--flip-x')) || 1;
               this.vandalTarget.vx = dir * 8;
               this.vandalTarget.vy = -5;
               
               const swatPhrases = ["Oops.", "Bye bye.", "Gravity check.", "Off you go."];
               this.speak(swatPhrases[Math.floor(Math.random() * swatPhrases.length)]);
               
               this.state = 'FLEE_CRIME';
               this.setCatClass('running');
               this.stateWaitFrames = 0;
               this.sprite.style.setProperty('--flip-x', -dir);
           } else {
               this.state = 'ON_PLATFORM';
               this.setCatClass('idle');
           }
       }
    }
    else if (this.state === 'FLEE_CRIME') {
       this.stateWaitFrames++;
       const dir = parseInt(this.sprite.style.getPropertyValue('--flip-x')) || 1;
       this.x += dir * 12; // run fast
       
       // Stop after a bit or if hitting edge of platform
       if (this.stateWaitFrames > 60) {
           this.state = 'ON_PLATFORM';
           this.setCatClass('idle');
           this.stateWaitFrames = 0;
       }
    }
    else if (this.state === 'FETCH_THROWN_GIFT') {
        const gift = this.vandalTarget;
        if (!gift || !gift.isFalling || !placedGifts.includes(gift)) {
            this.state = 'FALLING';
            this.currentPlatform = null;
            return;
        }
        
        const cx = this.x + 64;
        const cy = this.y + 128;
        const dx = gift.x - cx;
        const dy = gift.y - cy;
        
        const dir = Math.sign(dx) || 1;
        this.sprite.style.setProperty('--flip-x', dir);
        
        // Missile towards the gift
        this.x += dx * 0.15;
        this.y += dy * 0.15;
        this.sprite.style.backgroundPosition = `-256px 0px`;
        
        if (Math.hypot(dx, dy) < 40) {
            const idx = placedGifts.indexOf(gift);
            if (idx > -1) placedGifts.splice(idx, 1);
            
            this.carriedGiftElement = gift.el;
            const classes = Array.from(gift.el.classList);
            const typeClass = classes.find(c => c.startsWith('gift-'));
            this.giftType = typeClass ? typeClass.split('-')[1] : 'coffee';
            
            this.isFetchingGift = true;
            this.state = 'FETCH_GIFT_JUMP';
            this.pounceVx = dir * 15;
            this.pounceVy = -10;
            this.setCatClass('pounce');
            this.speak("Got it!");
            this.currentPlatform = null;
            this.lastTrackedHwnd = null;
        }
    }
    else if (this.state === 'JUMPING' || this.state === 'RESET_JUMP') {
      this.stateWaitFrames++;
      let animFrame = Math.floor(this.stateWaitFrames / 4);
      
      const oldCy = this.y + 128;
      if (animFrame >= 3) {
        this.x += this.pounceVx;
        this.y += this.pounceVy;
        this.pounceVy += 1.0; 
      }
      
      let frameIndex = Math.min(animFrame, 6);
      this.sprite.style.backgroundPosition = `-${frameIndex * 128}px 0px`;
      
      if (animFrame >= 3 && this.pounceVy > 0) { 
        const hit = checkCollision(this.x + 64, this.y + 128, oldCy, this.state === 'JUMPING' ? this.currentPlatform : null, platforms);
        if (hit) {
          this.y = hit.y - 128;
          this.currentPlatform = hit;
          this.state = 'LANDING';
          this.setCatClass('pounce');
          this.stateWaitFrames = 0;
        }
      }
    }
    else if (this.state === 'BREAK_MODE_PRE_JUMP') {
      this.stateWaitFrames++;
      this.setCatClass('pounce');
      this.sprite.style.backgroundPosition = `-256px 0px`; // 3rd frame (pre-jump crouch)
      
      const cx = this.x + 64;
      const dx = bugX - cx;
      this.sprite.style.setProperty('--flip-x', dx > 0 ? 1 : -1);
      
      if (this.stateWaitFrames > 120) { // Wait 2 seconds
          this.state = 'BREAK_MODE_JUMPING';
          this.stateWaitFrames = 0;
      }
    }
    else if (this.state === 'HUNT_PROP') {
        if (!this.huntTarget || !placedGifts.includes(this.huntTarget)) {
            this.state = 'IDLE';
            return;
        }
        
        const cx = this.x + 64;
        const dx = (this.huntTarget.x + 16) - cx;
        const dist = Math.abs(dx);
        
        if (dist < 40 && this.pounceVy === 0) {
            this.state = 'FORCED_SLEEP';
            this.setCatClass('sleep');
            this.stateWaitFrames = 0;
            this.sprite.style.setProperty('--flip-x', dx > 0 ? 1 : -1);
            this.huntTarget = null;
        } else {
            this.setCatClass('running');
            this.sprite.style.setProperty('--flip-x', dx > 0 ? 1 : -1);
            this.x += (dx > 0 ? 6 : -6);
            
            this.pounceVy += 1.0;
            if (this.pounceVy > 15) this.pounceVy = 15;
            
            const oldCy = this.y + 128;
            this.y += this.pounceVy;
            const hit = checkCollision(this.x + 64, this.y + 128, oldCy, null, platforms);
            if (hit && this.pounceVy > 0) {
                this.y = hit.y - 128;
                this.pounceVy = 0;
            }
        }
    }
    else if (this.state === 'BREAK_MODE_JUMPING') {
      const cx = this.x + 64;
      const cy = this.y + 128;
      
      // Aim slightly below bug tip so mouth hits it
      const targetX = bugX;
      const targetY = bugY + 30;
      
      const dx = targetX - cx;
      const dy = targetY - cy;
      const dist = Math.hypot(dx, dy);
      
      if (dist < 30) {
           this.state = 'BREAK_MODE_HANGING';
           this.setCatClass('pounce');
           this.sprite.style.backgroundPosition = `-384px 0px`;
           this.sprite.style.setProperty('--rot', '0deg');
           this.stateWaitFrames = 0;
           this.floorFrames = 0;
           this.sprite.style.transformOrigin = '50% 15px';
      } else {
         const speed = 25;
         this.x += (dx / dist) * speed;
         this.y += (dy / dist) * speed;
         this.sprite.style.setProperty('--flip-x', dx > 0 ? 1 : -1);
         this.stateWaitFrames++;
         
         let animFrame = Math.min(Math.floor(this.stateWaitFrames / 3), 6);
         this.sprite.style.backgroundPosition = `-${animFrame * 128}px 0px`;
         
         if (this.stateWaitFrames > 120) {
            this.state = 'FALLING';
            this.pounceVy = 0;
         }
      }
    }
    else if (this.state === 'EYE_BREAK_JUMPING') {
      const cx = this.x + 64;
      const cy = this.y + 128;
      
      const trackerRect = document.getElementById('light-bulb-tracker').getBoundingClientRect();
      const targetX = trackerRect.left + (trackerRect.width / 2);
      const targetY = trackerRect.top + (trackerRect.height / 2);
      
      const dx = targetX - cx;
      const dy = targetY - cy;
      const dist = Math.hypot(dx, dy);
      
      if (dist < 50) {
           document.getElementById('swinging-light').classList.add('off');
           document.getElementById('swinging-light').classList.add('pulled');
           document.getElementById('screen-dimmer').classList.add('dimmed');
           this.state = 'EYE_BREAK_HANGING';
           this.stateWaitFrames = 0;
           this.setCatClass('pounce');
           this.sprite.style.backgroundPosition = `-384px 0px`; // Middle jump frame
           this.sprite.style.setProperty('--rot', '0deg');
           this.sprite.style.transformOrigin = '50% 15px';
      } else {
           const speed = 30;
           this.x += (dx / dist) * speed;
           this.y += (dy / dist) * speed;
           
           if (dx < 0) this.sprite.style.transform = 'scaleX(1)';
           else this.sprite.style.transform = 'scaleX(-1)';
           
           const angle = Math.atan2(dy, dx) * 180 / Math.PI;
           const rot = (dx < 0) ? (angle - 180) : angle;
           this.sprite.style.setProperty('--rot', `${rot}deg`);
           
           // Animate the jump
           this.stateWaitFrames++;
           let animFrame = Math.min(Math.floor(this.stateWaitFrames / 3), 6);
           this.sprite.style.backgroundPosition = `-${animFrame * 128}px 0px`;
      }
    }
    else if (this.state === 'EYE_BREAK_HANGING') {
      this.stateWaitFrames++;
      
      const trackerRect = document.getElementById('light-bulb-tracker').getBoundingClientRect();
      this.x = trackerRect.left + (trackerRect.width / 2) - 64;
      this.y = trackerRect.top + (trackerRect.height / 2) - 30; // -30 to align mouth/paws
      
      if (this.stateWaitFrames > 30) {
          document.getElementById('swinging-light').classList.remove('pulled');
          this.state = 'FALLING';
          this.setCatClass('pounce');
          this.isEyeBreakJumping = false;
          this.isEyeBreakFalling = true;
          this.sprite.style.transformOrigin = 'center';
      }
    }
    else if (this.state === 'BREAK_MODE_HANGING') {
      this.stateWaitFrames++;
      
      // Paws are lower and to the side of the ear
      const flip = this.sprite.style.getPropertyValue('--flip-x') === '-1' ? -1 : 1;
      const pawX = flip === 1 ? 100 : 28;
      const pawY = 40;
      
      let rawTargetY = bugY - pawY;
      
      let groundY = screenH;
      for (let p of platforms) {
         if (bugX >= p.x && bugX <= p.x + p.w && p.y >= rawTargetY + 64) {
            if (p.y < groundY) groundY = p.y;
         }
      }
      
      let targetY = rawTargetY;
      let isOnGround = false;
      
      if (targetY >= groundY - 128) {
         isOnGround = true;
         targetY = groundY - 128;
      }
      
      if (!isOnGround) {
         // Follow bug horizontally ONLY while falling
         this.x = bugX - pawX;
      }
      this.y = targetY;
      
      if (this.stateWaitFrames > 60) {
          this.state = 'FALLING';
          this.container.style.transform = 'none';
          this.sprite.style.setProperty('--rot', '0deg');
          this.pounceVy = 0;
          this.pounceVx = 0;
          this.setCatClass('pounce');
      }
      
      if (isOnGround) {
         this.container.style.transform = 'none';
         this.sprite.style.setProperty('--flip-x', flip);
         
         this.floorFrames++;
         
         if (this.floorFrames < 120) {
            // Attack the cursor for 2 seconds! Lock X and Y!
            this.setCatClass('attack');
         } else {
            // Exhausted! Fall asleep ON the cursor, making it incredibly heavy
            this.setCatClass('sleep');
         }
         // Completely lock the mouse under the cat!
         ipcRenderer.send('drag-mouse', { x: this.x + pawX, y: targetY + pawY });
      } else {
         this.floorFrames = 0;
         
         // Reset animation direction if it was running backwards
         this.sprite.style.animationDirection = 'normal';
         
         // Restore hanging pose
         this.setCatClass('pounce');
         this.sprite.style.backgroundPosition = `-384px 0px`;
         
         // Swing left and right by rotating the entire container from the paw
         const swing = Math.sin(this.stateWaitFrames * 0.1) * 20;
         this.container.style.transformOrigin = `${pawX}px ${pawY}px`;
         this.container.style.transform = `rotate(${swing}deg)`;
         
         // Drag mouse down FAST
         ipcRenderer.send('drag-mouse', { x: mouseX, y: mouseY + 15 });
      }
    }
    
    // Apply position
    this.container.style.left = `${this.x}px`;
    this.container.style.top = `${this.y}px`;
  }
}

class Bird {
  constructor() {
    this.id = 'bird_' + Date.now() + Math.floor(Math.random() * 1000);
    this.x = Math.random() < 0.5 ? -100 : screenW + 100;
    this.y = 100 + Math.random() * (screenH / 2);
    this.vx = this.x < 0 ? 2 + Math.random() * 3 : -2 - Math.random() * 3;
    this.vy = 0;
    
    this.state = 'FLYING';
    this.stateWaitFrames = 0;
    this.currentPlatform = null;
    this.targetX = null;
    this.targetY = null;
    
    this.container = document.createElement('div');
    this.container.className = 'bird-container';
    
    this.sprite = document.createElement('div');
    this.sprite.className = 'bird-sprite bird-fly';
    
    this.debugSpan = document.createElement('div');
    this.debugSpan.style.position = 'absolute';
    this.debugSpan.style.color = 'red';
    this.debugSpan.style.fontSize = '12px';
    this.debugSpan.style.background = 'white';
    this.debugSpan.style.whiteSpace = 'nowrap';
    this.debugSpan.style.top = '70px';
    this.debugSpan.style.left = '0';
    this.debugSpan.style.zIndex = '9999';
    
    this.container.appendChild(this.sprite);
    this.container.appendChild(this.debugSpan);
    document.body.appendChild(this.container);
    
    this.setFlip(this.vx);
  }
  
  setFlip(vx) {
      if (vx > 0) this.sprite.style.setProperty('--flip-x', 1);
      else if (vx < 0) this.sprite.style.setProperty('--flip-x', -1);
  }
  
  setAnim(className) {
      this.sprite.className = 'bird-sprite ' + className;
  }
  
  update(platforms) {
      if (isNaN(this.x) || isNaN(this.y)) {
          this.destroy();
          return;
      }
      
      this.stateWaitFrames++;
      
      if (this.state === 'FLYING') {
          this.x += this.vx;
          this.y += Math.sin(this.stateWaitFrames * 0.05) * 1;
          
          if (this.x < -200 || this.x > screenW + 200) {
              this.destroy();
              return;
          }
          
          // Randomly decide to land if high enough and over a valid platform
          if (this.stateWaitFrames > 120 && Math.random() < 0.01) {
              const validPlatforms = platforms.filter(p => p.hwnd !== -1 && !String(p.hwnd).startsWith('line-') && p.w > 100);
              
              // Filter safe platforms (no cat within 600px scaled)
              const scale = screenW / 3440;
              const safeDist = 600 * scale;
              const safePlatforms = validPlatforms.filter(p => {
                  const px = p.x + p.w / 2;
                  const allCats = [...cats, ...longBreakCats];
                  return !allCats.some(c => Math.hypot(px - c.x, p.y - c.y) < safeDist);
              });
              
              if (safePlatforms.length > 0) {
                  this.currentPlatform = safePlatforms[Math.floor(Math.random() * safePlatforms.length)];
                  this.targetX = this.currentPlatform.x + 30 + Math.random() * (this.currentPlatform.w - 60);
                  this.targetY = this.currentPlatform.y - 64;
                  this.state = 'LANDING';
              }
          }
      } 
      else if (this.state === 'LANDING') {
          const dx = this.targetX - this.x;
          const dy = this.targetY - this.y;
          this.setFlip(dx);
          
          this.vx = dx * 0.05;
          this.vy = dy * 0.05;
          
          this.x += this.vx;
          this.y += this.vy;
          
          if (Math.abs(dx) < 5 && Math.abs(dy) < 5) {
              this.state = 'SITTING';
              this.setAnim('bird-sit');
              this.stateWaitFrames = 0;
              this.platformTime = 0;
              this.vx = 0;
              this.vy = 0;
          }
      }
      else if (this.state === 'SITTING') {
          this.platformTime = (this.platformTime || 0) + 1;
          if (this.platformTime > 600) { // Fly away after ~10 seconds
              this.state = 'ESCAPING';
              this.setAnim('bird-fly');
              this.vx = Math.random() < 0.5 ? 6 : -6;
              this.vy = -4;
              this.setFlip(this.vx);
          } else if (this.stateWaitFrames > 120 && Math.random() < 0.02) {
              this.state = 'WALKING';
              this.setAnim('bird-walk');
              this.targetX = this.currentPlatform.x + 30 + Math.random() * (this.currentPlatform.w - 60);
              if (isNaN(this.targetX)) this.targetX = this.x;
              this.setFlip(this.targetX - this.x);
          }
      }
      else if (this.state === 'WALKING') {
          this.platformTime = (this.platformTime || 0) + 1;
          if (this.platformTime > 600) {
              this.state = 'ESCAPING';
              this.setAnim('bird-fly');
              this.vx = Math.random() < 0.5 ? 6 : -6;
              this.vy = -4;
              this.setFlip(this.vx);
          } else {
              const dx = this.targetX - this.x;
              this.setFlip(dx);
              const dir = Math.sign(dx);
              
              if (Math.abs(dx) > 2) {
                  this.x += dir * 2;
              } else {
                  this.state = 'SITTING';
                  this.setAnim('bird-sit');
                  this.stateWaitFrames = 0;
              }
          }
      }
      else if (this.state === 'ESCAPING') {
          this.x += this.vx;
          this.y += this.vy;
          
          if (this.x < -200 || this.x > screenW + 200 || this.y < -200) {
              this.destroy();
              return;
          }
      }
      
      // Check for danger (cats nearby)
      // Update debug info
      try {
          const info = `${this.state} | x:${Math.round(this.x)} y:${Math.round(this.y)} | wait:${this.stateWaitFrames} plat:${this.platformTime||0}`;
          this.debugSpan.innerText = info;
          const fs = require('fs');
          fs.writeFileSync('bird_debug.txt', info);
      } catch (e) {}

      if (this.state !== 'FLYING' && this.state !== 'ESCAPING') {
          const scale = screenW / 3440;
          const dangerDist = 400 * scale; // Fly away if they get closer than this
          const allCats = [...cats, ...longBreakCats];
          
          // Also flee if cat is directly underneath but very far down, if it's hunting this bird
          const dangerCat = allCats.find(c => {
              const dist = Math.hypot(c.x - this.x, c.y - this.y);
              if (dist < dangerDist) return true;
              if (c.state === 'HUNTING_BIRD' && c.huntingBirdTarget === this && Math.abs(c.x - this.x) < 200) return true;
              return false;
          });
          
          if (dangerCat) {
              this.state = 'ESCAPING';
              this.setAnim('bird-fly');
              this.vx = this.x > dangerCat.x ? 6 : -6;
              this.vy = -4; // Fly up and away
              this.setFlip(this.vx);
          }
      }
      
      this.container.style.left = `${this.x}px`;
      this.container.style.top = `${this.y}px`;
  }
  
  destroy() {
      if (this.container.parentNode) {
          this.container.parentNode.removeChild(this.container);
      }
      const index = birds.indexOf(this);
      if (index > -1) birds.splice(index, 1);
  }
}

// Global drawing & platform logic
ipcRenderer.on('toggle-draw-mode', () => {
  if (isCustomizingBreak) return; // Prevent disabling drawing during customization
  isDrawingMode = !isDrawingMode;
  if (cats.length > 0) {
    const balloon = cats[0].balloon;
    if (isDrawingMode) {
      document.body.classList.add('drawing-mode');
      ipcRenderer.send('set-ignore-mouse-events', false);
      balloon.textContent = "Draw Mode Active!\nLeft Click: Draw Platform\nRight Click: Erase\nCtrl+Shift+S: Exit Draw Mode\nCtrl+Shift+H: Toggle Visibility\nCtrl+Shift+C: Clear All Shelves";
      balloon.style.display = 'block';
    } else {
      document.body.classList.remove('drawing-mode');
      balloon.style.display = 'none';
      updateGlobalHover();
    }
  }
});

ipcRenderer.on('toggle-shelves-visibility', () => {
  document.body.classList.toggle('hide-shelves');
});

ipcRenderer.on('clear-shelves', () => {
  virtualShelves = [];
  document.querySelectorAll('.shelf-visual').forEach(el => el.remove());
});

document.addEventListener('contextmenu', (e) => {
  if (isDrawingMode) e.preventDefault();
});

document.addEventListener('mousedown', (e) => {
  if (contextMenu.classList.contains('visible') && !contextMenu.contains(e.target)) {
    contextMenu.classList.remove('visible');
    document.getElementById('menu-overlay').style.display = 'none';
    updateGlobalHover();
  }
  
  if (!isDrawingMode) return;
  if (e.target.classList.contains('cat-sprite')) return;
  
  drawStartX = e.clientX;
  drawStartY = e.clientY;
  isErasing = (e.button === 2);
  
  currentDrawElement = document.createElement('div');
  currentDrawElement.className = isErasing ? 'eraser-visual' : (isCustomizingBreak ? 'break-custom-line' : 'shelf-visual');
  currentDrawElement.style.left = `${drawStartX}px`;
  currentDrawElement.style.top = `${drawStartY}px`;
  currentDrawElement.style.width = '0px';
  if (isErasing) currentDrawElement.style.height = '0px';
  document.body.appendChild(currentDrawElement);
});

let draggedGift = null;
let lastGiftMouseX = 0;
let lastGiftMouseY = 0;
let giftVx = 0;
let giftVy = 0;

document.addEventListener('mousemove', (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
  mouseIdleFrames = 0;
  
  if (draggedGift) {
      giftVx = mouseX - lastGiftMouseX;
      giftVy = mouseY - lastGiftMouseY;
      lastGiftMouseX = mouseX;
      lastGiftMouseY = mouseY;
      
      draggedGift.x = mouseX - 16;
      draggedGift.y = mouseY - 16;
      draggedGift.el.style.left = `${draggedGift.x}px`;
      draggedGift.el.style.top = `${draggedGift.y}px`;
  }
  
  if (!isDrawingMode || !currentDrawElement) return;
  
  const currentX = e.clientX;
  const currentY = e.clientY;
  const width = Math.abs(currentX - drawStartX);
  const left = Math.min(currentX, drawStartX);
  
  currentDrawElement.style.left = `${left}px`;
  currentDrawElement.style.width = `${width}px`;
  
  if (isErasing) {
    const height = Math.abs(currentY - drawStartY);
    const top = Math.min(currentY, drawStartY);
    currentDrawElement.style.top = `${top}px`;
    currentDrawElement.style.height = `${height}px`;
  }
});

document.addEventListener('mouseup', (e) => {
  if (!isDrawingMode || !currentDrawElement) return;
  
  const currentX = e.clientX;
  const currentY = e.clientY;
  const width = Math.abs(currentX - drawStartX);
  const left = Math.min(currentX, drawStartX);
  
  if (isErasing) {
    const height = Math.abs(currentY - drawStartY);
    const top = Math.min(currentY, drawStartY);
    const right = left + width;
    const bottom = top + height;
    
    const newShelves = [];
    for (let shelf of virtualShelves) {
      if (shelf.y >= top && shelf.y <= bottom) {
         const shelfLeft = shelf.x;
         const shelfRight = shelf.x + shelf.w;
         if (shelfRight <= left || shelfLeft >= right) {
            newShelves.push(shelf);
         } else {
            if (shelfLeft < left) {
               newShelves.push({ ...shelf, x: shelfLeft, w: left - shelfLeft, hwnd: `shelf-${Date.now()}-L` });
            }
            if (shelfRight > right) {
               newShelves.push({ ...shelf, x: right, w: shelfRight - right, hwnd: `shelf-${Date.now()}-R` });
            }
         }
      } else {
         newShelves.push(shelf);
      }
    }
    
    virtualShelves = newShelves;
    
    document.querySelectorAll('.shelf-visual').forEach(el => el.remove());
    for (let shelf of virtualShelves) {
       const div = document.createElement('div');
       div.className = isCustomizingBreak ? 'break-custom-line' : 'shelf-visual';
       div.style.left = `${shelf.x}px`;
       div.style.top = `${shelf.y}px`;
       div.style.width = `${shelf.w}px`;
       document.body.appendChild(div);
    }
    
    currentDrawElement.remove();
  } else {
    if (width > 20) {
      virtualShelves.push({
        hwnd: `shelf-${Date.now()}`,
        title: 'Virtual Shelf',
        x: left,
        y: drawStartY,
        w: width,
        h: 2
      });
    } else {
      currentDrawElement.remove();
    }
  }
  
  currentDrawElement = null;
});

document.addEventListener('mouseup', () => {
    if (draggedGift) {
        draggedGift.isFalling = true;
        draggedGift.wasThrown = true;
        draggedGift.hwnd = -1;
        draggedGift.vx = giftVx;
        draggedGift.vy = giftVy;
        draggedGift.el.style.pointerEvents = 'auto';
        draggedGift = null;
        updateGlobalHover();
    }
});

function getPlatforms() {
  const p = [];

  for (let i = 0; i < openWindows.length; i++) {
    const win = openWindows[i];
    if (win.title === 'Cat Friend') continue; // Never walk on our own transparent overlay
    if (win.w >= screenW - 20) continue;
    if (win.y <= 20) continue;
    
    // The top edge of this window is initially a single segment
    let segments = [{ x: win.x, w: win.w }];
    
    // Check against all HIGHER windows in Z-order (j < i)
    for (let j = 0; j < i; j++) {
      const topWin = openWindows[j];
      if (topWin.title === 'Cat Friend') continue; // Transparent overlay does not visually occlude anything!
      
      // Does topWin visually cover the top edge of `win`?
      if (topWin.y <= win.y && topWin.y + topWin.h >= win.y) {
         const blockLeft = topWin.x;
         const blockRight = topWin.x + topWin.w;
         
         const newSegments = [];
         for (let seg of segments) {
            const segLeft = seg.x;
            const segRight = seg.x + seg.w;
            
            if (blockRight <= segLeft || blockLeft >= segRight) {
               // No horizontal overlap at all
               newSegments.push(seg);
            } else {
               // Cut the segment
               if (segLeft < blockLeft) {
                  newSegments.push({ x: segLeft, w: blockLeft - segLeft });
               }
               if (segRight > blockRight) {
                  newSegments.push({ x: blockRight, w: segRight - blockRight });
               }
            }
         }
         segments = newSegments;
      }
    }
    
    // Add all surviving segments as individual platforms
    for (let seg of segments) {
       if (seg.w > 10) { // Only add segments that are wide enough for the cat
           p.push({ hwnd: win.hwnd, title: win.title, x: seg.x, y: win.y, w: seg.w, h: win.h });
       }
    }
  }
  
  // Default floor (taskbar)
  if (activeBreakType !== 'long' || breakEndTime === 0) {
      p.push({ hwnd: -1, x: -100, y: screenH, w: screenW + 200, h: 50 });
  }
  
  for (let shelf of virtualShelves) {
     p.push({ x: shelf.x, y: shelf.y, w: shelf.w, h: shelf.h, hwnd: shelf.hwnd });
  }

  // Only include real windows if not in a long break
  if (activeBreakType !== 'long' || breakEndTime === 0) {
      for (let win of openWindows) {
          if (win.width > 0 && win.height > 0) {
              p.push({
                  x: win.x,
                  y: win.y,
                  w: win.width,
                  h: win.height,
                  hwnd: win.hwnd,
                  title: win.title
              });
          }
      }
  }
  
  return p;
}

function checkCollision(cx, cy, oldCy, ignorePlatform, platforms) {
  for (let p of platforms) {
    if (ignorePlatform && p.hwnd === ignorePlatform.hwnd) continue;
    if (cx >= p.x && cx <= p.x + p.w) {
      if (oldCy < p.y && cy >= p.y) {
        return p;
      }
    }
  }
  return null;
}

// Instantiate the first cat
cats.push(new Cat('cat1'));

ipcRenderer.on('show-cat', () => {
  cats.forEach(c => c.show());
});

ipcRenderer.on('windows-data', (event, data) => {
  previousOpenWindows = openWindows;
  openWindows = data || [];
});

ipcRenderer.on('mouse-position', (event, { x, y }) => {
  const now = Date.now();
  
  // Check auto breaks
  if (breakEndTime === 0 && breakWarningEndTime === 0) {
      if (now - last90MinTime > 90 * 60 * 1000) {
          last90MinTime = now;
          last30MinTime = now; // Reset the 30min timer so they don't overlap
          upcomingBreakType = 'long';
          upcomingBreakDuration = 30 * 1000;
          breakWarningEndTime = now + 3000;
      } else if (now - last30MinTime > 30 * 60 * 1000) {
          last30MinTime = now;
          upcomingBreakType = 'short';
          upcomingBreakDuration = 3.5 * 60 * 1000;
          breakWarningEndTime = now + 3000;
      }
  }
  
  if (breakWarningEndTime > now) {
      const warningEl = document.getElementById('cursor-warning');
      warningEl.style.display = 'block';
      warningEl.style.left = `${mouseX}px`;
      warningEl.style.top = `${mouseY}px`;
  } else if (breakWarningEndTime > 0) {
      breakWarningEndTime = 0;
      document.getElementById('cursor-warning').style.display = 'none';
      breakEndTime = now + upcomingBreakDuration;
      activeBreakType = upcomingBreakType;
      
      if (activeBreakType === 'short') {
          cats.forEach(c => c.isTrueBreakMode = true);
      } else if (activeBreakType === 'long') {
          buildNatureEnvironment();
          nextCatSpawnTime = now + 3000; // wait 3s before first spawn
          
          cats.forEach(c => c.isAutonomous = true);
          
          if (cats.length > 0) {
              const originalCat = cats[0];
              const customPlatforms = virtualShelves.length > 0 ? virtualShelves : loadCustomPlatforms();
              
              if (customPlatforms.length > 0) {
                  let bestDist = Infinity;
                  let bestPlatform = null;
                  for (const p of customPlatforms) {
                      const px = p.x + p.w / 2;
                      const dist = Math.hypot(px - (originalCat.x + 64), p.y - (originalCat.y + 128));
                      if (dist < bestDist) {
                          bestDist = dist;
                          bestPlatform = p;
                      }
                  }
                  if (bestPlatform) {
                      const targetX = bestPlatform.x + 30 + Math.random() * (bestPlatform.w - 60);
                      originalCat.startJump(bestPlatform, originalCat.x + 64, originalCat.y + 128, targetX);
                  }
              }
          }
      }
  }
  
  // Eye-break logic
  if (now - last20MinTime > 20 * 60 * 1000) {
      if (cats.length > 0 && cats[0].state !== 'HUNTING_MOUSE' && !cats[0].isTrueBreakMode) {
          const success = triggerEyeBreak(cats[0]);
          if (success) {
              last20MinTime = now;
          } else {
              last20MinTime = now - 19 * 60 * 1000; // try again in 1 minute
          }
      }
  }

  const mouseVx = x - lastMouseX;
  const mouseVy = y - lastMouseY;
  const shakeSpeed = Math.hypot(mouseVx, mouseVy);
  
  cats.forEach(c => {
    if (c.state === 'BREAK_MODE_HANGING' && shakeSpeed > 40) {
      c.state = 'FALLING';
      c.container.style.transform = 'none';
      c.sprite.style.setProperty('--rot', '0deg');
      c.pounceVy = -10;
      c.pounceVx = mouseVx > 0 ? -15 : 15;
      c.setCatClass('pounce');
    }
  });

  if (x === lastMouseX && y === lastMouseY) {
    mouseIdleFrames++;
  } else {
    mouseIdleFrames = 0;
    lastMouseX = x;
    lastMouseY = y;
    cats.forEach(c => {
      if (c.state === 'SITTING' || c.state === 'SLEEPING') {
        c.state = 'WAKING_UP';
        c.setCatClass('pounce');
        c.sprite.style.backgroundPosition = `-256px 0px`;
        c.stateWaitFrames = 0;
      }
    });
  }
  
  mouseX = x;
  mouseY = y;
  
  updateGifts(getPlatforms());
});

// Main Loop
function update() {
  const now = Date.now();
  
  if (breakEndTime > now) {
      if (activeBreakType === 'short') {
          if (!wasInBreak) {
              bugX = bugTargetX = lastMouseX;
              bugY = bugTargetY = lastMouseY;
              wasInBreak = true;
          }
          
          if (document.body.style.cursor !== 'none') {
              document.body.style.cursor = 'none';
              updateGlobalHover();
          }
          
          document.getElementById('bug-fly').style.display = 'block';
          
          bugTargetX += (Math.random() - 0.5) * 100;
          bugTargetY += (Math.random() - 0.5) * 100;
          
          bugTargetX = Math.max(50, Math.min(screenW - 50, bugTargetX));
          bugTargetY = Math.max(50, Math.min(screenH - 50, bugTargetY));
          
          bugX += (bugTargetX - bugX) * 0.1;
          bugY += (bugTargetY - bugY) * 0.1;
          
          ipcRenderer.send('drag-mouse', { x: bugX, y: bugY });
          
          const bug = document.getElementById('bug-fly');
          bug.style.left = `${bugX}px`;
          bug.style.top = `${bugY}px`;
          
          const dx = bugTargetX - bugX;
          const dy = bugTargetY - bugY;
          const angle = Math.atan2(dy, dx) * 180 / Math.PI;
          bug.style.transform = `translate(-50%, -50%) rotate(${angle + 90}deg)`;
      } else if (activeBreakType === 'long') {
          document.getElementById('bug-fly').style.display = 'none';
          
          // Spawn birds during long break
          if (now > nextCatSpawnTime && longBreakCats.length < 20) {
              nextCatSpawnTime = now + 1000;
              const newCat = new Cat('breakcat_' + Date.now(), false, true);
              
              // Apply random styling
              const colors = [
                  'brightness(200%) sepia(100%) saturate(300%) hue-rotate(340deg)', // orange
                  'brightness(150%) sepia(100%) saturate(200%) hue-rotate(350deg)', // brown
                  'none', // black (base color)
                  'grayscale(100%) brightness(200%)', // grey
                  'grayscale(100%) brightness(500%)' // white
              ];
              const chosenFilter = colors[Math.floor(Math.random() * colors.length)];
              newCat.sprite.style.filter = chosenFilter === 'none' ? 'drop-shadow(0px 4px 6px rgba(0,0,0,0.5))' : `${chosenFilter} drop-shadow(0px 4px 6px rgba(0,0,0,0.5))`;
              
              const scale = 0.7 + Math.random() * 0.6;
              newCat.container.style.transform = `scale(${scale})`;
              newCat.container.style.transformOrigin = 'bottom center';
              
              newCat.show();
              
              const customPlatforms = loadCustomPlatforms();
              
              if (customPlatforms.length > 0) {
                  let targetPlatform = customPlatforms[Math.floor(Math.random() * customPlatforms.length)];
                  let targetX = targetPlatform.x + 30 + Math.random() * (targetPlatform.w - 60);
                  
                  const targetY = targetPlatform.y;
                  const distTop = targetY;
                  const distBottom = screenH - targetY;
                  const distLeft = targetX;
                  const distRight = screenW - targetX;
                  
                  const minDist = Math.min(distBottom, distLeft, distRight);
                  
                  if (minDist === distBottom) {
                      const offset = Math.random() < 0.5 ? -250 : 250;
                      newCat.x = targetX - 64 + offset;
                      newCat.y = screenH + 100;
                      newCat.startJump(targetPlatform, newCat.x + 64, newCat.y + 128, targetX);
                  } else if (minDist === distLeft) {
                      newCat.x = -200;
                      newCat.y = Math.min(screenH - 10, targetY + 200 + Math.random() * 200);
                      newCat.startJump(targetPlatform, newCat.x + 64, newCat.y + 128, targetX);
                  } else {
                      newCat.x = screenW + 200;
                      newCat.y = Math.min(screenH - 10, targetY + 200 + Math.random() * 200);
                      newCat.startJump(targetPlatform, newCat.x + 64, newCat.y + 128, targetX);
                  }
              } else {
                  newCat.x = Math.random() * (screenW - 128);
                  newCat.y = -200;
                  newCat.state = 'FALLING';
              }
              
              longBreakCats.push(newCat);
          }
          
          if (now > nextBirdSpawnTime && birds.length < 2) {
              nextBirdSpawnTime = now + 10000 + Math.random() * 10000;
              birds.push(new Bird());
          }
      }
  } else {
      wasInBreak = false;
      if (document.body.style.cursor === 'none') {
          document.body.style.cursor = 'default';
          updateGlobalHover();
      }
      document.getElementById('bug-fly').style.display = 'none';
      
      if (activeBreakType === 'long' && breakEndTime !== 0) {
          const env = document.getElementById('nature-environment');
          if (env) env.innerHTML = '';
          
          // Remove break environment platforms from physics
          virtualShelves = virtualShelves.filter(shelf => !String(shelf.hwnd).startsWith('shelf-env-'));
          
          cats.forEach(c => {
             c.isAutonomous = false;
             
             const customPlatforms = loadCustomPlatforms();
             
             if (customPlatforms.length > 0) {
                 const targetPlatform = customPlatforms[Math.floor(Math.random() * customPlatforms.length)];
                 const targetX = targetPlatform.x + 30 + Math.random() * (targetPlatform.w - 60);
                 c.startJump(targetPlatform, c.x + 64, c.y + 128, targetX);
             } else {
                 if (c.state === 'AUTONOMOUS_WALK' || c.state === 'SLEEPING' || c.state === 'SITTING') {
                     c.state = 'FALLING';
                     c.setCatClass('pounce');
                     c.pounceVy = 0;
                     c.currentPlatform = null;
                 }
             }
          });
          
          longBreakCats.forEach(c => {
              if (c) {
                  c.isAutonomous = false;
                  c.state = 'RUN_AWAY';
                  c.isLeaving = true;
                  cats.push(c);
              }
          });
          longBreakCats = [];
          
          [...birds].forEach(b => b.destroy());
      }
      
      if (activeBreakType === 'short' && breakEndTime !== 0) {
          const flyGiftEl = document.createElement('div');
          flyGiftEl.className = 'cat-gift gift-fly';
          
          flyGiftEl.addEventListener('mousedown', (e) => {
              isDraggingGift = true;
              draggedGift = flyProp;
              dragOffsetX = e.clientX - flyProp.x;
              dragOffsetY = e.clientY - flyProp.y;
              e.preventDefault();
          });
          
          document.body.appendChild(flyGiftEl);
          
          const flyProp = {
              x: mouseX,
              y: mouseY,
              vx: 0,
              vy: 0,
              el: flyGiftEl,
              isFalling: true,
              hwnd: -1,
              offsetX: 0,
              isFly: true
          };
          placedGifts.push(flyProp);
          
          cats.forEach(c => {
              c.isTrueBreakMode = false;
              if (c.state === 'BREAK_MODE_PRE_JUMP' || c.state === 'BREAK_MODE_JUMPING' || c.state === 'BREAK_MODE_HANGING') {
                  c.state = 'HUNT_PROP';
                  c.huntTarget = flyProp;
                  c.balloon.style.display = 'none';
              }
          });
      }
      
      if (breakEndTime !== 0) {
          breakEndTime = 0;
          activeBreakType = '';
          last20MinTime = now;
      }
  }
  
  const platforms = getPlatforms();
  cats.forEach(cat => cat.update(platforms));
  longBreakCats.forEach(cat => cat.update(platforms));
  birds.forEach(bird => bird.update(platforms));
  if (Math.random() < 0.05) { // Roughly every few seconds at 60fps
      try {
          const domState = {
              birds: birds.map(b => ({x: b.x, y: b.y, state: b.state})),
              birdElements: Array.from(document.querySelectorAll('.bird-container')).map(el => ({
                  left: el.style.left,
                  top: el.style.top,
                  display: getComputedStyle(el).display,
                  rect: el.getBoundingClientRect()
              })),
              bugFly: document.getElementById('bug-fly') ? {
                  display: document.getElementById('bug-fly').style.display,
                  left: document.getElementById('bug-fly').style.left,
                  top: document.getElementById('bug-fly').style.top,
                  computedDisplay: getComputedStyle(document.getElementById('bug-fly')).display
              } : null
          };
          ipcRenderer.send('log', JSON.stringify(domState, null, 2));
      } catch(e) {}
  }
  
  requestAnimationFrame(update);
}
requestAnimationFrame(update);

// Menu Action Listeners
document.getElementById('menu-friend').addEventListener('click', (e) => {
  e.stopPropagation();
  contextMenu.classList.remove('visible');
  document.getElementById('menu-overlay').style.display = 'none';
  if (activeContextCat && (activeContextCat.state === 'FORCED_SLEEP' || activeContextCat.state === 'FORCED_SIT')) {
     activeContextCat.state = 'WAKING_UP';
     activeContextCat.setCatClass('pounce');
     activeContextCat.sprite.style.backgroundPosition = `-256px 0px`;
     activeContextCat.stateWaitFrames = 0;
  }
  updateGlobalHover();
});

document.getElementById('menu-twin').addEventListener('click', (e) => {
  e.stopPropagation();
  contextMenu.classList.remove('visible');
  document.getElementById('menu-overlay').style.display = 'none';
  
  const activeTwins = cats.filter(c => c.isTwin && !c.isLeaving);
  if (activeTwins.length === 0) {
    const twin = new Cat('cat2', true);
    cats.push(twin);
    twin.show();
    document.getElementById('menu-twin').textContent = 'Single Mode';
  } else {
    activeTwins.forEach(twin => {
       twin.state = 'RUN_AWAY';
       twin.isLeaving = true;
    });
    document.getElementById('menu-twin').textContent = 'Twin Mode';
  }
  updateGlobalHover();
});

document.getElementById('menu-gift').addEventListener('click', (e) => {
  e.stopPropagation();
  contextMenu.classList.remove('visible');
  document.getElementById('menu-overlay').style.display = 'none';
  
  if (activeContextCat) {
    activeContextCat.isFetchingGift = true;
    
    const r = Math.random();
    if (r < 0.2) {
       activeContextCat.giftType = 'coffee';
    } else if (r < 0.4) {
       activeContextCat.giftType = 'plant';
    } else if (r < 0.6) {
       activeContextCat.giftType = 'fish';
    } else if (r < 0.8) {
       activeContextCat.giftType = 'yarn';
    } else {
       activeContextCat.giftType = 'mouse';
    }
    activeContextCat.giftBgPos = '';
    
    activeContextCat.state = 'FETCH_GIFT_WALK_OFF';
    activeContextCat.pounceVx = activeContextCat.x < screenW / 2 ? -15 : 15;
    activeContextCat.setCatClass('running');
  }
  updateGlobalHover();
});

document.getElementById('menu-force-eye').addEventListener('click', (e) => {
  e.stopPropagation();
  contextMenu.classList.remove('visible');
  document.getElementById('menu-overlay').style.display = 'none';
  
  if (activeContextCat) {
    triggerEyeBreak(activeContextCat);
    last20MinTime = Date.now();
  }
  updateGlobalHover();
});

document.getElementById('btn-reload-app').addEventListener('click', (e) => {
  e.stopPropagation();
  contextMenu.classList.remove('visible');
  document.getElementById('menu-overlay').style.display = 'none';
  location.reload();
});

document.getElementById('menu-force-short').addEventListener('click', (e) => {
  e.stopPropagation();
  contextMenu.classList.remove('visible');
  document.getElementById('menu-overlay').style.display = 'none';
  
  upcomingBreakType = 'short';
  upcomingBreakDuration = 10 * 1000; // 10 SECONDS FOR TESTING
  breakWarningEndTime = Date.now() + 3000;
  last30MinTime = Date.now();
  
  updateGlobalHover();
});

document.getElementById('menu-force-long').addEventListener('click', (e) => {
  e.stopPropagation();
  contextMenu.classList.remove('visible');
  document.getElementById('menu-overlay').style.display = 'none';
  
  upcomingBreakType = 'long';
  upcomingBreakDuration = 30 * 1000; // 30 SECONDS FOR TESTING (Long Break)
  breakWarningEndTime = Date.now() + 3000;
  last90MinTime = Date.now();
  last30MinTime = Date.now(); // Reset short break timer as well
  
  updateGlobalHover();
});

document.getElementById('menu-sit').addEventListener('click', (e) => {
  e.stopPropagation();
  contextMenu.classList.remove('visible');
  document.getElementById('menu-overlay').style.display = 'none';
  if (activeContextCat) {
    activeContextCat.state = 'FORCED_SIT';
    activeContextCat.setCatClass('sit');
  }
  updateGlobalHover();
});

document.getElementById('menu-sleep').addEventListener('click', (e) => {
  e.stopPropagation();
  contextMenu.classList.remove('visible');
  document.getElementById('menu-overlay').style.display = 'none';
  if (activeContextCat) {
    activeContextCat.state = 'FORCED_SLEEP';
    activeContextCat.setCatClass('sleep');
  }
  updateGlobalHover();
});

document.getElementById('menu-customize-break').addEventListener('click', (e) => {
  e.stopPropagation();
  contextMenu.classList.remove('visible');
  document.getElementById('menu-overlay').style.display = 'none';
  
  isCustomizingBreak = true;
  normalShelvesBackup = virtualShelves.slice();
  
  const customPlatforms = loadCustomPlatforms();
  virtualShelves = customPlatforms;
  
  document.querySelectorAll('.shelf-visual').forEach(el => el.remove());
  for (let shelf of virtualShelves) {
    const div = document.createElement('div');
    div.className = isCustomizingBreak ? 'break-custom-line' : 'shelf-visual';
    div.style.left = shelf.x + 'px';
    div.style.top = shelf.y + 'px';
    div.style.width = shelf.w + 'px';
    document.body.appendChild(div);
  }
  
  const env = document.getElementById('nature-environment');
  env.innerHTML = '';
  env.style.zIndex = 5;
  const bgImage = document.createElement('img');
  bgImage.src = 'cat_bg_images/bg_image_1.png';
  bgImage.className = 'env-background';
  env.appendChild(bgImage);
  
  isDrawingMode = true;
  document.body.classList.add('drawing-mode');
  ipcRenderer.send('set-ignore-mouse-events', false);
  document.getElementById('save-break-btn').style.display = 'block';
  document.getElementById('clear-break-btn').style.display = 'block';
  updateGlobalHover();
});

document.getElementById('clear-break-btn').addEventListener('click', () => {
  virtualShelves = [];
  document.querySelectorAll('.break-custom-line').forEach(el => el.remove());
});

document.getElementById('save-break-btn').addEventListener('click', () => {
  require('fs').writeFileSync('custom_break_platforms.json', JSON.stringify({
      resolution: { w: screenW, h: screenH },
      platforms: virtualShelves
  }, null, 2));
  
  isCustomizingBreak = false;
  isDrawingMode = false;
  document.body.classList.remove('drawing-mode');
  document.getElementById('save-break-btn').style.display = 'none';
  document.getElementById('clear-break-btn').style.display = 'none';
  
  const env = document.getElementById('nature-environment');
  env.innerHTML = '';
  
  document.querySelectorAll('.shelf-visual').forEach(el => el.remove());
  document.querySelectorAll('.break-custom-line').forEach(el => el.remove());
  document.querySelectorAll('.eraser-visual').forEach(el => el.remove()); // Just in case
  
  virtualShelves = normalShelvesBackup;
  for (let shelf of virtualShelves) {
    const div = document.createElement('div');
    div.className = isCustomizingBreak ? 'break-custom-line' : 'shelf-visual';
    div.style.left = shelf.x + 'px';
    div.style.top = shelf.y + 'px';
    div.style.width = shelf.w + 'px';
    document.body.appendChild(div);
  }
  updateGlobalHover();
});
