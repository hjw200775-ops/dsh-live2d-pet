/** Motion playback policy for pixi-live2d-display 0.4.0.
 * The adapter's _startMotion and the viewer's activate() both called stopAllMotions,
 * which drops the previous motion before its fade-out. The queue itself already fades
 * the previous entry when startMotion is used directly.
 * Meta.Loop is true on every shipped motion, including one-shot transitions, and this
 * adapter never reads that flag (loop defaults to false).
 *
 * 会循环的只有「持续状态」的组：待机和思考。其余（回答、出错、手势）都是一次性的。 */

const LOOPING_GROUPS = new Set(['Idle', 'Thinking']);

export function attachMotionPolicy(motionManager, { loopingGroups = LOOPING_GROUPS } = {}) {
  const createMotion = motionManager.createMotion.bind(motionManager);
  motionManager.createMotion = function createMotionWithLoopPolicy(data, group, definition) {
    const motion = createMotion(data, group, definition);
    const idleGroup = (this.groups && this.groups.idle) || 'Idle';
    const shouldLoop = group === idleGroup || loopingGroups.has(group);
    if (typeof motion.setIsLoop === 'function') motion.setIsLoop(shouldLoop);
    return motion;
  };
  motionManager._startMotion = function startMotionCrossfade(motion, onFinish) {
    if (motion && typeof motion.setFinishedMotionHandler === 'function') motion.setFinishedMotionHandler(onFinish);
    return this.queueManager.startMotion(motion, false, performance.now());
  };
  return motionManager;
}

export function isLoopingGroup(group) {
  return LOOPING_GROUPS.has(group);
}
