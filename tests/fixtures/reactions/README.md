# Public Reaction Fixture

`ord-astra-zeneca.json` is a normalized projection of deposited reaction
`ord-56b1f4bfeebc4b8ab990b9804e798aa7`, not a simulated reaction.
It is derived from the Open Reaction Database's 750 AstraZeneca ELN dataset:

- Dataset: `ord_dataset-00005539a1e04c809a9a78647bea649c`
- Pinned official mirror: https://huggingface.co/datasets/open-reaction-database/ord-data/blob/93475c46949f9218e1dfb6624096025135db2add/data/00/ord_dataset-00005539a1e04c809a9a78647bea649c.parquet
- Original file SHA256: `bf1686ca6edac300a61acb5a5ee006ab5fd61007962ae19062b3d3c7879f84a9`
- Publication: https://chemrxiv.org/engage/chemrxiv/article-details/60c9e3f37792a23bfdb2d471
- Dataset authors and attribution: https://github.com/open-reaction-database/ord-data/blob/83f971f586f6ad18f358ae4ae99d045e94ed2066/CITATION.cff
- Data license: **CC-BY-SA-4.0**, https://creativecommons.org/licenses/by-sa/4.0/

Changes are normalization of structures, unit/source-field projection and
exclusion of administrative contact details. Raw yield fields, stated precision,
procedure and source identity remain. This fixture retains its data license;
the surrounding X-Synth code is Apache-2.0. Tests cannot claim this experimental
record validates an unrelated target or a newly predicted route.

`ord-inchi-tautomer.json` retains the scientific fields of deposited record
`ord-e8642ae0ecb248809067cd131fde0eed` from the ORD USPTO grants dataset
`ord_dataset-1158e351757f315b93cbcbe7bc55f38e`; administrative contact metadata
is omitted. It has the same **CC-BY-SA-4.0** data license and attribution above.
Pinned source: https://huggingface.co/datasets/open-reaction-database/ord-data/blob/93475c46949f9218e1dfb6624096025135db2add/data/11/ord_dataset-1158e351757f315b93cbcbe7bc55f38e.parquet
Original SHA256: `d0fa5e21c621d16714bae1b9157022b5a3ea02db909a2af8d7b5b976f7c950b5`.
The source SMILES are not converted to the tautomer reconstructed from InChI.
