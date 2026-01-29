use ark_bn254::{Bn254, Fq, Fq2, G1Affine, G2Affine};
use ark_ff::PrimeField;
use ark_groth16::VerifyingKey;
use ark_serialize::CanonicalSerialize;
use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::str::FromStr;
use num_bigint::BigInt;
use num_traits::{Num, Zero};

use num_bigint::BigUint;

#[derive(Debug, Deserialize)]
struct SnarkJsVk {
    protocol: String,
    curve: String,
    nPublic: usize,
    vk_alpha_1: Vec<String>,
    vk_beta_2: Vec<Vec<String>>,
    vk_gamma_2: Vec<Vec<String>>,
    vk_delta_2: Vec<Vec<String>>,
    vk_alphabeta_12: Vec<Vec<Vec<String>>>,
    IC: Vec<Vec<String>>,
}

fn parse_fq(s: &str) -> Fq {
    let s = if s.starts_with("0x") { &s[2..] } else { s };
    let n = BigUint::from_str_radix(s, 10).unwrap();
    Fq::from_le_bytes_mod_order(&n.to_bytes_le())
}

fn parse_g1(pt: &[String]) -> G1Affine {
    let x = parse_fq(&pt[0]);
    let y = parse_fq(&pt[1]);
    let z = parse_fq(&pt[2]); // checking infinity? Usually snarkjs uses 3 coords for projective or 2 for affine?
    // SnarkJS projective output: [x, y, z]
    // If z=0, it's infinity.
    if z.is_zero() {
        G1Affine::identity()
    } else {
        G1Affine::new(x, y)
    }
}

fn parse_g2(pt: &[Vec<String>]) -> G2Affine {
    // pt is [[x0, x1], [y0, y1], [z0, z1]]
    // x = x0 + u*x1
    let x0 = parse_fq(&pt[0][0]);
    let x1 = parse_fq(&pt[0][1]);
    let y0 = parse_fq(&pt[1][0]);
    let y1 = parse_fq(&pt[1][1]);
    let z0 = parse_fq(&pt[2][0]);
    let z1 = parse_fq(&pt[2][1]);

    let x = Fq2::new(x0, x1);
    let y = Fq2::new(y0, y1);
    let z = Fq2::new(z0, z1);

    if z.is_zero() {
        G2Affine::identity()
    } else {
        G2Affine::new(x, y)
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() != 2 {
        eprintln!("Usage: {} <path-to-verification_key.json>", args[0]);
        std::process::exit(1);
    }

    let path = &args[1];
    let content = fs::read_to_string(path).expect("Failed to read file");
    let vk_json: SnarkJsVk = serde_json::from_str(&content).expect("Failed to parse JSON");

    let alpha_g1 = parse_g1(&vk_json.vk_alpha_1);
    let beta_g2 = parse_g2(&vk_json.vk_beta_2);
    let gamma_g2 = parse_g2(&vk_json.vk_gamma_2);
    let delta_g2 = parse_g2(&vk_json.vk_delta_2);
    
    let ic: Vec<G1Affine> = vk_json.IC.iter().map(|pt| parse_g1(pt)).collect();

    let vk = VerifyingKey::<Bn254> {
        alpha_g1,
        beta_g2,
        gamma_g2,
        delta_g2,
        gamma_abc_g1: ic,
    };

    let mut bytes = Vec::new();
    vk.serialize_compressed(&mut bytes).expect("Failed to serialize");
    
    println!("{}", hex::encode(bytes));
}
