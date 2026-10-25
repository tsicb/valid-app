/**
 * Browser-side HMAC key discovery for authorised ETL sessions.
 * Long-lived key is separate from ACCESS_KEY and never stored in a dataset.
 * Deployment must be coupled to the incremental-update Pages release.
 */
function vaaEnsureIdentitySecret_() {
  const props = PropertiesService.getScriptProperties();
  let key = normalizeString_(props.getProperty('VAA_APPLICATION_IDENTITY_HMAC_V1'));
  if (key) return key;

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    key = normalizeString_(props.getProperty('VAA_APPLICATION_IDENTITY_HMAC_V1'));
    if (!key) {
      key = [
        Utilities.getUuid().replace(/-/g, ''),
        Utilities.getUuid().replace(/-/g, ''),
        Utilities.getUuid().replace(/-/g, '')
      ].join('');
      props.setProperty('VAA_APPLICATION_IDENTITY_HMAC_V1', key);
    }
    return key;
  } finally {
    lock.releaseLock();
  }
}

function vaaHandleIdentityKey_(payload) {
  const validation = validateManageAuth_(payload);
  if (!validation.ok) {
    return errorOutput_(validation.code, validation.message);
  }
  if (normalizeString_(payload.pagesVersion) !==
      API_CONFIG.EXPECTED_PAGES_VERSION) {
    return errorOutput_(
      'PAGES_VERSION_MISMATCH',
      'ETL Pagesと中央APIのバージョンが一致しません。'
    );
  }
  return jsonOutput_({
    ok: true,
    action: 'MANAGE_IDENTITY_KEY',
    updateProtocol: 'IDENTITY_V1',
    keyVersion: VAAAppendMergeCore.VERSION,
    identitySecret: vaaEnsureIdentitySecret_()
  });
}
