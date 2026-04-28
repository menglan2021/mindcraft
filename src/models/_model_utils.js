export function resolveKeyName(params, explicitKeyName, defaultKeyName = null) {
    return explicitKeyName || params?.key_name || params?.keyName || defaultKeyName;
}

export function sanitizeRequestParams(params = {}) {
    const sanitized = { ...(params || {}) };
    delete sanitized.key_name;
    delete sanitized.keyName;
    return sanitized;
}
