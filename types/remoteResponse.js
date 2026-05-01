'use strict';

/**
 * Fabric {@link Remote} returns `{ status: 'error', message, code? }` for failed HTTP — not thrown.
 * @param {unknown} data
 * @param {string} label
 */
function throwIfFabricHttpError (data, label) {
  if (
    data &&
    typeof data === 'object' &&
    data.status === 'error'
  ) {
    let msg =
      data.message != null && String(data.message).trim() !== ''
        ? String(data.message)
        : 'remote error';
    const rawCode = data.code;
    const codeNum =
      rawCode != null && rawCode !== '' ? Number(rawCode) : NaN;
    const codeOk = Number.isFinite(codeNum);

    // @fabric/http Remote maps most HTTP errors to message "Unhandled HTTP status code." + numeric `code`.
    if (codeOk) {
      if (codeNum === 429) {
        msg = 'Rate limited';
      } else if (codeNum === 503) {
        msg = 'Service unavailable';
      }
    }

    const codeSuffix = codeOk
      ? ` [${codeNum}]`
      : rawCode != null && String(rawCode).trim() !== ''
        ? ` [${rawCode}]`
        : '';
    throw new Error(`${label}: ${msg}${codeSuffix}`);
  }
}

/**
 * CoinGecko uses `{ status: { error_code, error_message } }` for quota / API faults (often HTTP 200).
 * @param {unknown} data
 * @param {string} label
 */
function throwIfCoingeckoError (data, label) {
  throwIfFabricHttpError(data, label);
  const st = data && typeof data === 'object' ? data.status : null;
  if (st && typeof st === 'object' && st.error_message != null) {
    const msg = String(st.error_message);
    const code = st.error_code != null ? ` [${st.error_code}]` : '';
    throw new Error(`${label}: ${msg}${code}`);
  }
}

module.exports = {
  throwIfFabricHttpError,
  throwIfCoingeckoError
};
