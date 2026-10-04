"""Audit ORD-derived identities against the structures actually recorded."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from functools import lru_cache

from rdkit import rdBase

from packages.adapters.askcos.reference_identity import (
    canonical_reference_query,
    component_multiset,
    parse_reference_reaction,
)
from packages.adapters.askcos.reference_models import ReferenceSearchInput

from .ord_reader import OrdRecordError


@lru_cache(maxsize=16_384)
def _definite_smiles(value: str) -> str:
    return canonical_reference_query(ReferenceSearchInput(product=value)).product


def compound_smiles(compound, *, required: bool) -> str | None:
    from ord_schema import message_helpers

    try:
        identities = set()
        with rdBase.BlockLogs():
            for identifier in compound.identifiers:
                if identifier.type not in message_helpers.STRUCTURAL_IDENTIFIER_TYPES:
                    continue
                smiles = message_helpers.canonical_smiles_for_identifier(identifier.type, identifier.value)
                if smiles is None:
                    raise OrdRecordError("invalid_compound_structure")
                identities.add(_definite_smiles(smiles))
        if len(identities) > 1:
            raise OrdRecordError("inconsistent_compound_identifiers")
        if identities:
            return identities.pop()
    except OrdRecordError:
        raise
    except (ValueError, RuntimeError) as exc:
        raise OrdRecordError("invalid_compound_structure") from exc
    if required:
        raise OrdRecordError("undefined_compound_structure")
    return None


@dataclass(frozen=True)
class OrdOutcomeStructures:
    index: int
    products: tuple[str, ...]
    product_by_index: dict[int, str]


@dataclass(frozen=True)
class OrdReactionStructures:
    reactants: tuple[str, ...]
    agents: tuple[str, ...]
    input_smiles: dict[tuple[str, int], str | None]
    outcomes: tuple[OrdOutcomeStructures, ...]
    rejected_outcomes: tuple[tuple[int, str], ...]


def _side_signature(structures) -> Counter:
    # Repeated additions are distinct inputs/amounts, not extra chemical species.
    return component_multiset(sorted(set(structures)))


def audit_ord_structures(reaction) -> OrdReactionStructures:
    from ord_schema import message_helpers
    from ord_schema.proto import reaction_pb2

    roles = reaction_pb2.ReactionRole
    with rdBase.BlockLogs():
        derived = message_helpers.derived_reaction_smiles(reaction)
    if derived is None:
        raise OrdRecordError("missing_derived_reaction_smiles")
    try:
        derived_reactants, derived_products, _ = parse_reference_reaction(derived)
    except (ValueError, RuntimeError) as exc:
        raise OrdRecordError("invalid_derived_reaction_smiles") from exc

    reactants, agents, input_smiles = [], [], {}
    for key in sorted(reaction.inputs):
        item = reaction.inputs[key]
        if item.crude_components:
            raise OrdRecordError("unresolved_crude_input")
        for index, compound in enumerate(item.components):
            role = compound.reaction_role
            is_reactant = role in (roles.REACTANT, roles.UNSPECIFIED)
            smiles = compound_smiles(compound, required=is_reactant)
            input_smiles[key, index] = smiles
            if smiles is not None and is_reactant:
                reactants.append(smiles)
            elif smiles is not None and role in (roles.REAGENT, roles.SOLVENT, roles.CATALYST):
                agents.append(smiles)
    if not reactants or _side_signature(reactants) != component_multiset(derived_reactants):
        raise OrdRecordError("derived_reactant_mismatch")

    outcomes, rejected = [], []
    product_roles = (roles.PRODUCT, roles.UNSPECIFIED, roles.BYPRODUCT, roles.SIDE_PRODUCT)
    for index, outcome in enumerate(reaction.outcomes):
        try:
            products, identities = [], {}
            for product_index, product in enumerate(outcome.products):
                if product.reaction_role not in product_roles:
                    if any(m.type == reaction_pb2.ProductMeasurement.YIELD for m in product.measurements):
                        raise OrdRecordError("yield_on_nonproduct_species")
                    continue
                smiles = compound_smiles(product, required=True)
                identities[product_index] = smiles
                products.append(smiles)
            if not products:
                raise OrdRecordError("missing_recorded_products")
            outcomes.append(OrdOutcomeStructures(index, tuple(sorted(set(products))), identities))
        except OrdRecordError as exc:
            rejected.append((index, exc.code))

    if not outcomes:
        raise OrdRecordError("no_structurally_valid_outcomes")
    # A recorded equation may describe the final outcome of a time course. Other
    # outcomes keep their own deposited product sets; they are never interpolated.
    signatures = [_side_signature(item.products) for item in outcomes]
    union = _side_signature(product for item in outcomes for product in item.products)
    if component_multiset(derived_products) not in [union, *signatures]:
        raise OrdRecordError("derived_product_mismatch")

    # The derived helper intentionally omits agents. Keep explicitly recorded
    # agent-block structures too, without ever promoting them to reactants.
    for identifier in reaction.identifiers:
        if identifier.type in (
            reaction_pb2.ReactionIdentifier.REACTION_SMILES,
            reaction_pb2.ReactionIdentifier.REACTION_CXSMILES,
        ) and identifier.value:
            try:
                recorded_r, recorded_p, recorded_a = parse_reference_reaction(identifier.value)
            except (ValueError, RuntimeError) as exc:
                raise OrdRecordError("invalid_recorded_reaction_smiles") from exc
            if component_multiset(recorded_r) != component_multiset(derived_reactants):
                raise OrdRecordError("recorded_reactant_mismatch")
            if component_multiset(recorded_p) not in [union, *signatures]:
                raise OrdRecordError("recorded_product_mismatch")
            agents.extend(recorded_a)
    return OrdReactionStructures(
        tuple(sorted(set(reactants))), tuple(sorted(set(agents))), input_smiles,
        tuple(outcomes), tuple(rejected),
    )


def evidence_reaction_smiles(structures: OrdReactionStructures, products: tuple[str, ...]):
    def side(values):
        return ".".join(f"({value})" if "." in value else value for value in values)

    smiles = f"{side(structures.reactants)}>{'.'.join(structures.agents)}>{side(products)}"
    reactants, product_list, agents = parse_reference_reaction(smiles)
    return smiles, reactants, product_list, agents
