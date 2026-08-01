//! Hoplite's test-free embedding facade over the shared Hara VM sources.

#[path = "../../hara-runtime/src/vm/artifact.rs"]
pub mod artifact;
#[path = "../../hara-runtime/src/vm/compiler.rs"]
pub mod compiler;
#[path = "../../hara-runtime/src/vm/disassemble.rs"]
pub mod disassemble;
#[path = "../../hara-runtime/src/vm/error.rs"]
pub mod error;
#[path = "../../hara-runtime/src/vm/fiber.rs"]
pub mod fiber;
#[path = "../../hara-runtime/src/vm/frame.rs"]
pub mod frame;
#[path = "../../hara-runtime/src/vm/machine.rs"]
pub mod machine;
#[path = "../../hara-runtime/src/vm/opcode.rs"]
pub mod opcode;
#[path = "../../hara-runtime/src/vm/program.rs"]
pub mod program;
#[path = "../../hara-runtime/src/vm/slot.rs"]
mod slot;
#[path = "../../hara-runtime/src/vm/source_map.rs"]
pub mod source_map;
#[path = "../../hara-runtime/src/vm/validate.rs"]
pub mod validate;

pub use compiler::{compile_source, compile_source_with};
pub use disassemble::disassemble;
pub use fiber::{VmFiber, VmFiberState};
pub use machine::execute_program;
