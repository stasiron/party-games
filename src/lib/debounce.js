/**
 * @param {() => void} fn
 * @param {number} ms
 */
export function debounce(fn, ms) {
    let id;
    const debounced = () => {
        clearTimeout(id);
        id = setTimeout(fn, ms);
    };
    debounced.cancel = () => clearTimeout(id);
    return debounced;
}
