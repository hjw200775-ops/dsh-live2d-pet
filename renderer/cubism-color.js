/* Cubism 4.2+ multiply/screen color for pixi-live2d-display 0.4.0.
   That adapter samples the atlas and never reads drawable multiplyColors/screenColors.
   DeepSeek-chan's nose meshes are black in the atlas and take their color from these
   vectors; skipping them draws the keyhole-shaped black atlas texels.
   Shader math matches the Cubism SDK for Web model pass. Mask setup is unchanged.
   pixi-live2d-display is MIT; this file does not modify node_modules. */
(function installCubismDrawableColor(live2d) {
  if (!live2d || live2d.__dshDrawableColor) return;
  const Shader = live2d.CubismShader_WebGL;
  const Renderer = live2d.CubismRenderer_WebGL;
  if (!Shader || !Renderer) throw new Error('Cubism WebGL renderer is not loaded');
  const colorHeader = 'uniform vec4 u_multiplyColor;uniform vec4 u_screenColor;';
  const colorBody = 'c.rgb=c.rgb*u_multiplyColor.rgb;c.rgb=(c.rgb+u_screenColor.rgb*c.a)-(c.rgb*u_screenColor.rgb);';
  const vertex = 'attribute vec4 a_position;attribute vec2 a_texCoord;varying vec2 v_texCoord;uniform mat4 u_matrix;void main(){gl_Position=u_matrix*a_position;v_texCoord=a_texCoord;v_texCoord.y=1.0-v_texCoord.y;}';
  const vertexMasked = 'attribute vec4 a_position;attribute vec2 a_texCoord;varying vec2 v_texCoord;varying vec4 v_clipPos;uniform mat4 u_matrix;uniform mat4 u_clipMatrix;void main(){gl_Position=u_matrix*a_position;v_clipPos=u_clipMatrix*a_position;v_texCoord=a_texCoord;v_texCoord.y=1.0-v_texCoord.y;}';
  const fragment = 'precision mediump float;varying vec2 v_texCoord;uniform vec4 u_baseColor;uniform sampler2D s_texture0;' + colorHeader + 'void main(){vec4 c=texture2D(s_texture0,v_texCoord);' + colorBody + 'gl_FragColor=c*u_baseColor;}';
  const fragmentMasked = 'precision mediump float;varying vec2 v_texCoord;varying vec4 v_clipPos;uniform vec4 u_baseColor;uniform vec4 u_channelFlag;uniform sampler2D s_texture0;uniform sampler2D s_texture1;' + colorHeader + 'void main(){vec4 c=texture2D(s_texture0,v_texCoord);' + colorBody + 'c=c*u_baseColor;vec4 clipMask=(1.0-texture2D(s_texture1,v_clipPos.xy/v_clipPos.w))*u_channelFlag;float maskVal=clipMask.r+clipMask.g+clipMask.b+clipMask.a;gl_FragColor=c*maskVal;}';
  const fragmentInverted = 'precision mediump float;varying vec2 v_texCoord;varying vec4 v_clipPos;uniform vec4 u_baseColor;uniform vec4 u_channelFlag;uniform sampler2D s_texture0;uniform sampler2D s_texture1;' + colorHeader + 'void main(){vec4 c=texture2D(s_texture0,v_texCoord);' + colorBody + 'c=c*u_baseColor;vec4 clipMask=(1.0-texture2D(s_texture1,v_clipPos.xy/v_clipPos.w))*u_channelFlag;float maskVal=clipMask.r+clipMask.g+clipMask.b+clipMask.a;gl_FragColor=c*(1.0-maskVal);}';
  const originalGenerate = Shader.prototype.generateShaders;
  Shader.prototype.generateShaders = function generateShadersWithDrawableColor() {
    originalGenerate.call(this);
    const previous = [1, 2, 3].map(index => this._shaderSets[index] && this._shaderSets[index].shaderProgram);
    this._shaderSets[1].shaderProgram = this.loadShaderProgram(vertex, fragment);
    this._shaderSets[2].shaderProgram = this.loadShaderProgram(vertexMasked, fragmentMasked);
    this._shaderSets[3].shaderProgram = this.loadShaderProgram(vertexMasked, fragmentInverted);
    this._shaderSets[4].shaderProgram = this._shaderSets[7].shaderProgram = this._shaderSets[1].shaderProgram;
    this._shaderSets[5].shaderProgram = this._shaderSets[8].shaderProgram = this._shaderSets[2].shaderProgram;
    this._shaderSets[6].shaderProgram = this._shaderSets[9].shaderProgram = this._shaderSets[3].shaderProgram;
    for (const program of previous) {
      if (program) this.gl.deleteProgram(program);
    }
    const bind = (index, masked) => {
      const set = this._shaderSets[index];
      const program = set.shaderProgram;
      set.attributePositionLocation = this.gl.getAttribLocation(program, 'a_position');
      set.attributeTexCoordLocation = this.gl.getAttribLocation(program, 'a_texCoord');
      set.samplerTexture0Location = this.gl.getUniformLocation(program, 's_texture0');
      set.uniformMatrixLocation = this.gl.getUniformLocation(program, 'u_matrix');
      set.uniformBaseColorLocation = this.gl.getUniformLocation(program, 'u_baseColor');
      set.uniformMultiplyColorLocation = this.gl.getUniformLocation(program, 'u_multiplyColor');
      set.uniformScreenColorLocation = this.gl.getUniformLocation(program, 'u_screenColor');
      if (masked) {
        set.samplerTexture1Location = this.gl.getUniformLocation(program, 's_texture1');
        set.uniformClipMatrixLocation = this.gl.getUniformLocation(program, 'u_clipMatrix');
        set.uniformChannelFlagLocation = this.gl.getUniformLocation(program, 'u_channelFlag');
      }
    };
    for (const index of [1, 4, 7]) bind(index, false);
    for (const index of [2, 3, 5, 6, 8, 9]) bind(index, true);
  };
  const originalSetup = Shader.prototype.setupShaderProgram;
  Shader.prototype.setupShaderProgram = function setupShaderProgramWithDrawableColor(renderer, textureId, vertexCount, vertexArray, indexArray, uvArray, bufferData, opacity, colorBlendMode, baseColor, isPremultipliedAlpha, matrix4x4, invertedMask) {
    originalSetup.call(this, renderer, textureId, vertexCount, vertexArray, indexArray, uvArray, bufferData, opacity, colorBlendMode, baseColor, isPremultipliedAlpha, matrix4x4, invertedMask);
    if (renderer.getClippingContextBufferForMask()) return;
    const index = renderer._drawableIndex;
    const drawables = renderer.getModel() && renderer.getModel()._model && renderer.getModel()._model.drawables;
    const multiply = drawables && drawables.multiplyColors;
    const screen = drawables && drawables.screenColors;
    const offset = index * 4;
    const multiplyColor = multiply && index >= 0 ? [multiply[offset], multiply[offset + 1], multiply[offset + 2], multiply[offset + 3]] : [1, 1, 1, 1];
    const screenColor = screen && index >= 0 ? [screen[offset], screen[offset + 1], screen[offset + 2], screen[offset + 3]] : [0, 0, 0, 1];
    const clipping = renderer.getClippingContextBufferForDraw();
    const shaderIndex = (clipping ? (invertedMask ? 2 : 1) : 0) + (colorBlendMode === 1 ? 3 : colorBlendMode === 2 ? 6 : 0) + 1;
    const set = this._shaderSets[shaderIndex];
    if (!set || set.uniformMultiplyColorLocation == null) return;
    this.gl.uniform4f(set.uniformMultiplyColorLocation, multiplyColor[0], multiplyColor[1], multiplyColor[2], multiplyColor[3]);
    this.gl.uniform4f(set.uniformScreenColorLocation, screenColor[0], screenColor[1], screenColor[2], screenColor[3]);
  };
  /* The library's doDrawModel keeps the drawable index in a local. Mask draws happen
     inside setupClippingContext before this loop and leave _drawableIndex at -1. */
  Renderer.prototype.doDrawModel = function doDrawModelWithDrawableIndex() {
    this.preDraw();
    if (this._clippingManager != null) this._clippingManager.setupClippingContext(this.getModel(), this);
    const drawableCount = this.getModel().getDrawableCount();
    const renderOrder = this.getModel().getDrawableRenderOrders();
    for (let i = 0; i < drawableCount; ++i) this._sortedDrawableIndexList[renderOrder[i]] = i;
    for (let i = 0; i < drawableCount; ++i) {
      const drawableIndex = this._sortedDrawableIndexList[i];
      if (!this.getModel().getDrawableDynamicFlagIsVisible(drawableIndex)) continue;
      this._drawableIndex = drawableIndex;
      this.setClippingContextBufferForDraw(this._clippingManager != null ? this._clippingManager.getClippingContextListForDraw()[drawableIndex] : null);
      this.setIsCulling(this.getModel().getDrawableCulling(drawableIndex));
      this.drawMesh(
        this.getModel().getDrawableTextureIndices(drawableIndex),
        this.getModel().getDrawableVertexIndexCount(drawableIndex),
        this.getModel().getDrawableVertexCount(drawableIndex),
        this.getModel().getDrawableVertexIndices(drawableIndex),
        this.getModel().getDrawableVertices(drawableIndex),
        this.getModel().getDrawableVertexUvs(drawableIndex),
        this.getModel().getDrawableOpacity(drawableIndex),
        this.getModel().getDrawableBlendMode(drawableIndex),
        this.getModel().getDrawableInvertedMaskBit(drawableIndex)
      );
    }
    this._drawableIndex = -1;
  };
  live2d.__dshDrawableColor = 'multiply-screen-v1';
})(window.PIXI && window.PIXI.live2d);
