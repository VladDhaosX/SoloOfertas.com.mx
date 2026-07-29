let activeOperation = null;

function beginMaintenance(operation) {
  if (activeOperation) return false;
  activeOperation = String(operation || 'maintenance');
  return true;
}

function endMaintenance(operation) {
  if (!operation || activeOperation === operation) activeOperation = null;
}

function maintenanceOperation() {
  return activeOperation;
}

module.exports = {
  beginMaintenance,
  endMaintenance,
  maintenanceOperation,
};
