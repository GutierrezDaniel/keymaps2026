//! Core layer: domain + ports + application use cases. This layer is agnostic of
//! any infrastructure (crypto, persistence, clipboard, desktop).

pub mod application;
pub mod domain;
pub mod ports;
