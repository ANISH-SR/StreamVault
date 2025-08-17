pub mod streaming_strategy;
pub mod linear_streaming;
pub mod exponential_streaming;
pub use streaming_strategy::{StreamingStrategy, StreamingContext, AccelerationType};
pub pub use exponential_streaming::ExponentialStreamingStrategy;