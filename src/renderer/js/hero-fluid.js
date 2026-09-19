/**
 * ReNet Hero Fluid Grid Shader - Adapted from Trae.cn Hero Fluid Grid
 * 
 * Features:
 * - Pure WebGL, 0 external dependencies, 60-120 FPS
 * - Transparent alpha background channel (preserves dark glassmorphism card gradient)
 * - Dynamic color interpolation (smooth morphing between Idle Blue and Running Green)
 * - Mouse proximity ripple effect inside the card container
 * - Optical vignette edge falloff for readability of foreground buttons & text
 */

class HeroFluidGrid {
  /**
   * @param {HTMLElement|string} container 
   * @param {Object} options 
   */
  constructor(container, options = {}) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    if (!this.container) {
      throw new Error('HeroFluidGrid: container element not found.');
    }

    // Default configuration matching User's preferred parameters
    this.options = Object.assign({
      speed: 0.20,
      density: 0.6,
      strength: 1.6,
      frequency: 3.5,
      
      // Default Idle: ReNet Cyber Ice-Blue
      color1: [90 / 255, 175 / 255, 255 / 255],  // #5AAFFF Electric Blue
      color2: [220 / 255, 240 / 255, 255 / 255], // Soft White-Blue
      
      pixelSize: 6.5,         // Tile size in CSS pixels
      pixelGap: 2.0,          // Gap between tiles in CSS pixels
      threshold: 0.87,        // User Image 1 threshold
      greenRatio: 0.55,       // Ratio of color1 vs color2
      brightnessOffset: 0.0,
      tileAlpha: 0.85,        // Tile opacity
      
      mouseRadius: 0.35,      // Mouse proximity interaction radius
      mouseStrength: 1.2,
      mouseEase: 0.08,
      dpr: Math.min(window.devicePixelRatio || 1, 1.5)
    }, options);

    // Target colors for smooth lerping
    this.targetColor1 = [...this.options.color1];
    this.targetColor2 = [...this.options.color2];
    this.currentColor1 = [...this.options.color1];
    this.currentColor2 = [...this.options.color2];
    this.currentThreshold = this.options.threshold;

    this.mouse = { x: 0.5, y: 0.5 };
    this.targetMouse = { x: 0.5, y: 0.5 };
    this.mouseMoved = false;

    this.rafId = null;
    this.startTime = performance.now();

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onResize = this._onResize.bind(this);
    this._animate = this._animate.bind(this);

    this.init();
  }

  init() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hero-fluid-canvas';
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.borderRadius = 'inherit';
    this.canvas.style.zIndex = '1';
    this.canvas.style.opacity = '0.40'; // User Image 1 & 2 opacity
    
    // Insert into hero-bg-container or before first child
    const targetParent = this.container.querySelector('.hero-bg-container') || this.container;
    if (targetParent.firstChild) {
      targetParent.insertBefore(this.canvas, targetParent.firstChild);
    } else {
      targetParent.appendChild(this.canvas);
    }

    const glOpts = {
      alpha: true,              // Transparent canvas
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance'
    };

    this.gl = this.canvas.getContext('webgl', glOpts) || this.canvas.getContext('experimental-webgl', glOpts);
    if (!this.gl) {
      console.error('HeroFluidGrid: WebGL not supported.');
      return;
    }

    this._initProgram();
    this._initBuffers();
    this._onResize();

    // Mouse tracking on container for precise interaction
    this.container.addEventListener('mousemove', this._onMouseMove, { passive: true });
    this.container.addEventListener('mouseleave', () => {
      this.targetMouse.x = 0.5;
      this.targetMouse.y = 0.5;
    }, { passive: true });

    window.addEventListener('resize', this._onResize, { passive: true });
    
    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this._onResize());
      this.resizeObserver.observe(this.container);
    }

    this.rafId = requestAnimationFrame(this._animate);
  }

  _initProgram() {
    const gl = this.gl;

    const vsSource = `
      attribute vec2 aPosition;
      varying vec2 vUv;
      void main() {
        vUv = aPosition * 0.5 + 0.5;
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `;

    const fsSource = `
      precision highp float;

      uniform float uTime;
      uniform vec2 uResolution;
      uniform float uSpeed;
      uniform float uDensity;
      uniform float uStrength;
      uniform float uFrequency;
      uniform vec3 uColor1;
      uniform vec3 uColor2;
      uniform vec2 uMouse;
      uniform float uMouseRadius;
      uniform float uMouseStrength;

      uniform float uPixelSize;
      uniform float uPixelGap;
      uniform float uThreshold;
      uniform float uGreenRatio;
      uniform float uBrightnessOffset;
      uniform float uTileAlpha;

      varying vec2 vUv;

      vec2 hash(vec2 p) {
        p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
        return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
      }

      float noise(vec2 p) {
        const float K1 = 0.366025404;
        const float K2 = 0.211324865;

        vec2 i = floor(p + (p.x + p.y) * K1);
        vec2 a = p - i + (i.x + i.y) * K2;
        vec2 o = (a.x > a.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec2 b = a - o + K2;
        vec2 c = a - 1.0 + 2.0 * K2;

        vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
        vec3 n = h * h * h * h * vec3(dot(a, hash(i + 0.0)), dot(b, hash(i + o)), dot(c, hash(i + 1.0)));

        return dot(n, vec3(70.0));
      }

      float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;
        float frequency = 1.0;

        for (int i = 0; i < 3; i++) {
          value += amplitude * noise(p * frequency);
          frequency *= 2.0;
          amplitude *= 0.5;
        }

        return value * 0.5 + 0.5;
      }

      vec2 computeFluidFlow(vec2 uv, float time, float speed, float density, float frequency) {
        vec2 q = vec2(
          fbm(uv * density + vec2(0.0, 0.2 * time * speed)),
          fbm(uv * density + vec2(1.2, -0.3 * time * speed))
        );

        vec2 flowVector = vec2(q.x * 0.3, q.y * 0.7) * 2.0;
        flowVector.x *= 0.5;
        flowVector.y *= 1.5;

        return flowVector;
      }

      float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
      }

      vec3 sampleFluidColor(vec2 uv, float time) {
        float t = time * uSpeed;
        vec2 q = vec2(
          fbm(uv * uDensity + vec2(0.0, 0.2 * t)),
          fbm(uv * uDensity + vec2(1.2, -0.3 * t))
        );
        float noiseVal = fbm(uv * uDensity + q * uFrequency);
        return mix(uColor1, uColor2, noiseVal);
      }

      void main() {
        vec2 pixelCoord = vUv * uResolution;
        float totalSize = uPixelSize + uPixelGap;

        vec2 blockId = floor(pixelCoord / totalSize);
        vec2 blockCenterUV = (blockId * totalSize + vec2(uPixelSize / 2.0)) / uResolution;

        vec2 flow = computeFluidFlow(blockCenterUV, uTime, 0.15, 1.5, 2.5) * 35.0;

        vec2 blockPos = blockId * totalSize;
        vec2 posInBlock = pixelCoord - blockPos;

        // Gap check: if in the gap between tiles, completely transparent!
        if (posInBlock.x > uPixelSize || posInBlock.y > uPixelSize) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
          return;
        }

        vec2 offsetBlockPos = blockPos - flow;
        vec2 offsetBlockCenter = offsetBlockPos + vec2(uPixelSize / 2.0);
        vec2 blockUv = offsetBlockCenter / uResolution;

        vec3 fluidCol = sampleFluidColor(blockUv, uTime);
        float rawBrightness = (fluidCol.r + fluidCol.g + fluidCol.b) / 3.0;
        float brightness = max(0.0, rawBrightness + uBrightnessOffset);

        float rand = random(blockId);
        float dynamicThreshold = uThreshold - 0.08 * rand;

        float dist = distance(blockCenterUV, uMouse);
        float mouseFactor = (1.0 - smoothstep(0.0, uMouseRadius, dist)) * uMouseStrength;

        // Subtle soft vignette: tiles gently fade toward the card edges
        vec2 centerOffset = abs(vUv - 0.5) * 2.0;
        float vignette = 1.0 - smoothstep(0.7, 1.05, length(centerOffset));

        // Threshold activation
        if (brightness > dynamicThreshold) {
          vec3 tileColor;
          if (rand < uGreenRatio) {
            tileColor = uColor1;
            if (mouseFactor > 0.0) {
              tileColor = mix(tileColor, uColor2, clamp(mouseFactor, 0.0, 1.0));
            }
          } else {
            tileColor = uColor2;
            if (mouseFactor > 0.0) {
              tileColor = mix(tileColor, uColor1, clamp(mouseFactor, 0.0, 1.0));
            }
          }

          // Gentle Alpha blending
          float alpha = uTileAlpha * vignette;
          gl_FragColor = vec4(tileColor, alpha);
        } else {
          // Inactive tiles are transparent
          gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        }
      }
    `;

    const vs = this._compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = this._compileShader(gl.FRAGMENT_SHADER, fsSource);

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('HeroFluidGrid Shader link error:', gl.getProgramInfoLog(program));
      return;
    }

    this.program = program;
    gl.useProgram(program);

    this.uniforms = {
      uTime: gl.getUniformLocation(program, 'uTime'),
      uResolution: gl.getUniformLocation(program, 'uResolution'),
      uSpeed: gl.getUniformLocation(program, 'uSpeed'),
      uDensity: gl.getUniformLocation(program, 'uDensity'),
      uStrength: gl.getUniformLocation(program, 'uStrength'),
      uFrequency: gl.getUniformLocation(program, 'uFrequency'),
      uColor1: gl.getUniformLocation(program, 'uColor1'),
      uColor2: gl.getUniformLocation(program, 'uColor2'),
      uMouse: gl.getUniformLocation(program, 'uMouse'),
      uMouseRadius: gl.getUniformLocation(program, 'uMouseRadius'),
      uMouseStrength: gl.getUniformLocation(program, 'uMouseStrength'),
      uPixelSize: gl.getUniformLocation(program, 'uPixelSize'),
      uPixelGap: gl.getUniformLocation(program, 'uPixelGap'),
      uThreshold: gl.getUniformLocation(program, 'uThreshold'),
      uGreenRatio: gl.getUniformLocation(program, 'uGreenRatio'),
      uBrightnessOffset: gl.getUniformLocation(program, 'uBrightnessOffset'),
      uTileAlpha: gl.getUniformLocation(program, 'uTileAlpha')
    };
  }

  _compileShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('HeroFluidGrid compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  _initBuffers() {
    const gl = this.gl;
    const vertices = new Float32Array([
      -1.0, -1.0,
       1.0, -1.0,
      -1.0,  1.0,
       1.0,  1.0
    ]);

    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const aPosition = gl.getAttribLocation(this.program, 'aPosition');
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
  }

  _onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = 1.0 - (e.clientY - rect.top) / rect.height;

    this.targetMouse.x = Math.max(0.0, Math.min(1.0, x));
    this.targetMouse.y = Math.max(0.0, Math.min(1.0, y));

    if (!this.mouseMoved) {
      this.mouse.x = this.targetMouse.x;
      this.mouse.y = this.targetMouse.y;
      this.mouseMoved = true;
    }
  }

  _onResize() {
    if (!this.canvas || !this.gl) return;
    const rect = this.container.getBoundingClientRect();
    const dpr = this.options.dpr || 1;
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));

    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
    }
  }

  /**
   * Set target theme colors for smooth dynamic morphing
   * @param {Array<number>} color1 [r, g, b] in 0..1
   * @param {Array<number>} color2 [r, g, b] in 0..1
   * @param {number} speed Flow speed
   */
  setThemeState(color1, color2, speed = null) {
    this.targetColor1 = [...color1];
    this.targetColor2 = [...color2];
    if (speed !== null) {
      this.options.speed = speed;
    }
  }

  _animate(now) {
    if (!this.gl || !this.program) return;

    const gl = this.gl;
    const opt = this.options;

    // Smooth color & threshold morphing (lerp towards target values)
    const colorLerpSpeed = 0.05;
    for (let i = 0; i < 3; i++) {
      this.currentColor1[i] += (this.targetColor1[i] - this.currentColor1[i]) * colorLerpSpeed;
      this.currentColor2[i] += (this.targetColor2[i] - this.currentColor2[i]) * colorLerpSpeed;
    }
    this.currentThreshold += (opt.threshold - this.currentThreshold) * 0.05;

    // Mouse easing lerp
    const dx = this.targetMouse.x - this.mouse.x;
    const dy = this.targetMouse.y - this.mouse.y;
    this.mouse.x += dx * opt.mouseEase;
    this.mouse.y += dy * opt.mouseEase;

    gl.useProgram(this.program);

    const elapsedTime = (now - this.startTime) * 0.001;
    gl.uniform1f(this.uniforms.uTime, elapsedTime);
    gl.uniform2f(this.uniforms.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.uSpeed, opt.speed);
    gl.uniform1f(this.uniforms.uDensity, opt.density);
    gl.uniform1f(this.uniforms.uStrength, opt.strength);
    gl.uniform1f(this.uniforms.uFrequency, opt.frequency);
    gl.uniform3fv(this.uniforms.uColor1, this.currentColor1);
    gl.uniform3fv(this.uniforms.uColor2, this.currentColor2);

    gl.uniform2f(this.uniforms.uMouse, this.mouse.x, this.mouse.y);
    gl.uniform1f(this.uniforms.uMouseRadius, opt.mouseRadius);
    gl.uniform1f(this.uniforms.uMouseStrength, opt.mouseStrength);

    const dpr = opt.dpr || 1;
    gl.uniform1f(this.uniforms.uPixelSize, opt.pixelSize * dpr);
    gl.uniform1f(this.uniforms.uPixelGap, opt.pixelGap * dpr);
    gl.uniform1f(this.uniforms.uThreshold, this.currentThreshold);
    gl.uniform1f(this.uniforms.uGreenRatio, opt.greenRatio);
    gl.uniform1f(this.uniforms.uBrightnessOffset, opt.brightnessOffset);
    gl.uniform1f(this.uniforms.uTileAlpha, opt.tileAlpha !== undefined ? opt.tileAlpha : 0.85);

    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    this.rafId = requestAnimationFrame(this._animate);
  }

  setOptions(newOpts) {
    Object.assign(this.options, newOpts);
    if (newOpts.color1) this.targetColor1 = [...newOpts.color1];
    if (newOpts.color2) this.targetColor2 = [...newOpts.color2];
  }

  destroy() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    window.removeEventListener('resize', this._onResize);

    if (this.gl && this.program) {
      this.gl.deleteProgram(this.program);
    }
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HeroFluidGrid;
} else if (typeof window !== 'undefined') {
  window.HeroFluidGrid = HeroFluidGrid;
}
