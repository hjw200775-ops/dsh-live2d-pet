// Cubism 顺序：动作 → saveParameters → naturalMovements → physics → mesh → loadParameters。
// 在保存之后、物理之前加控制器增量，既能驱动物理绑定，也不会污染下一帧基线。
export function attachNaturalOverlay(internalModel, sample) {
  const original = internalModel.updateNaturalMovements;
  internalModel.updateNaturalMovements = function(dt, now) {
    original?.call(this, dt, now);
    for (const [id, value] of Object.entries(sample(dt, now))) {
      this.coreModel.addParameterValueById(id, value);
    }
  };
}
