@vertex
fn main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
    let positions = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
    return vec4f(positions[index], 0, 1);
}
