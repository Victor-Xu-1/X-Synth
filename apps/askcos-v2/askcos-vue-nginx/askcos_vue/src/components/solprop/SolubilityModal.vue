<template>
    <v-dialog v-model="propShow" scrollable>
        <v-card>
            <v-card-title>
                溶解度模型输入 / 输出说明
            </v-card-title>
            <v-card-text class="py-5">
                <p class="text-h6"><strong>必填输入</strong></p>
                <ul>
                    <li>
                        <b>Solvent SMILES</b>:
                        溶剂结构的 SMILES。
                    </li>
                    <li>
                        <b>Solute SMILES</b>:
                        溶质结构的 SMILES。
                    </li>
                    <li>
                        <b>Temperature</b>:
                        需要计算固体溶解度和溶剂化性质的温度，单位为 K。
                    </li>
                </ul>

                <p class="text-h6"><strong>可选输入 1：溶质参考数据</strong></p>
                <p>
                    可以提供同一溶质在其他溶剂和 / 或其他温度下的参考溶解度，以提升预测精度。
                    使用该选项时，参考溶剂、参考溶解度和参考温度三项需要同时填写。
                </p>
                <ul>
                    <li>
                        <b>Ref. Solvent SMILES</b>:
                        参考溶剂结构的 SMILES。
                    </li>
                    <li>
                        <b>Ref. Solubility</b>:
                        输入溶质在参考溶剂和参考温度下的溶解度，单位为 logS（log10(mol/L)）。
                    </li>
                    <li>
                        <b>Ref. Temperature</b>:
                        参考温度，单位为 K。
                    </li>
                </ul>

                <p class="text-h6"><strong>可选输入 2：溶质热力学数据</strong></p>
                <p>
                    可以填写下列任意热力学参数，用于提升温度相关溶解度预测。
                    通常 ΔHsub298 对温度相关预测的影响大于 Cpg298 和 Cps298。
                </p>
                <ul>
                    <li>
                        <b>ΔHsub298</b>:
                        输入溶质在 298 K 下的升华焓，单位为 kcal/mol。
                    </li>
                    <li>
                        <b>Cpg298</b>:
                        输入溶质在 298 K 气相中的热容，单位为 cal/K/mol。
                    </li>
                    <li>
                        <b>Cps298</b>:
                        输入溶质在 298 K 固相中的热容，单位为 cal/K/mol。
                    </li>
                </ul>

                <p class="text-h6"><strong>批量上传文件格式</strong></p>
                <p>
                    输入参数也可以通过 .csv 或 .json 文件上传。列名 / 字段名需要与
                    <a href="/api/v2/solubility/" target="_blank">Solubility API</a>
                    的参数名保持一致。.csv 文件需要包含表头，所有列都需要存在，空值可以保留。
                    .json 文件应使用对象数组形式，每个对象可以只填写部分字段，空字段可使用 null。
                </p>

                <details class="mb-3">
                    <summary>.csv 输入示例</summary>
                    <v-card bg-variant="light">
                        <pre class="ma-0">solvent,solute,temp,ref_solvent,ref_solubility,ref_temp,hsub298,cp_gas_298,cp_solid_298
  CCCCO,c1ccoc1,298,,,,,,</pre>
                    </v-card>
                </details>

                <details class="mb-3">
                    <summary>.json 输入示例</summary>
                    <v-card bg-variant="light">
                        <pre class="ma-0">[
  {
    "solvent": "CCCCO",
    "solute": "c1ccoc1",
    "temp": 298
  },
  {
    "solvent": "CCCCO",
    "solute": "c1ccoc1",
    "temp": 298,
    "ref_solvent": null,
    "ref_solubility": null,
    "ref_temp": null,
    "hsub298": null,
    "cp_gas_298": null,
    "cp_solid_298": null
  }
  ]</pre>
                    </v-card>
                </details>

                <h4 class="text-h6">模型输出字段</h4>
                <ul>
                    <li>
                        <b>logS (method1) [log10(mol/L)]</b>:
                        输入溶质在指定溶剂和温度下的预测溶解度。method1 使用 298 K 常数溶解焓近似温度依赖性。
                        350 K 以下 method1 与 method2 精度接近；350 K 以上 method2 通常更准确。
                    </li>
                    <li>
                        <b>logS (method2) [log10(mol/L)]</b>:
                        输入溶质在指定溶剂和温度下的预测溶解度。method2 使用温度相关溶解焓估计溶解度温度依赖性，
                        高温下通常优于 method1；目前仅覆盖约 100 种常见溶剂。
                    </li>
                    <li>
                        <b>dGsolv [kcal/mol]</b>:
                        指定温度下溶剂 / 溶质对的预测溶剂化自由能。仅在 method2 可用时输出。
                    </li>
                    <li>
                        <b>dHsolv [kcal/mol]</b>:
                        指定温度下溶剂 / 溶质对的预测溶剂化焓。仅在 method2 可用时输出。
                    </li>
                    <li>
                        <b>dSsolv [cal/K/mol]</b>:
                        指定温度下溶剂 / 溶质对的预测溶剂化熵。仅在 method2 可用时输出。
                    </li>
                    <li>
                        <b>Pred. Hsub298 [kcal/mol]</b>:
                        输入溶质在 298 K 的预测升华焓。若用户已输入 ΔHsub298，则该字段为空。
                    </li>
                    <li>
                        <b>Pred. Cpg298 [cal/K/mol]</b>:
                        输入溶质在 298 K 气相中的预测热容。若用户已输入 Cpg298，则该字段为空。
                    </li>
                    <li>
                        <b>Pred. Cps298 [cal/K/mol]</b>:
                        输入溶质在 298 K 固相中的预测热容。若用户已输入 Cps298，则该字段为空。
                    </li>
                    <li>
                        <b>logS298 [log10(mol/L)]</b>:
                        输入溶质在指定溶剂、298 K 下的预测溶解度。
                    </li>
                    <li>
                        <b>Uncertainty logS298 [log10(mol/L)]</b>:
                        logS298 预测不确定性，由模型集成预测方差估计。
                    </li>
                    <li>
                        <b>dGsolv298 [kcal/mol]</b>:
                        溶剂 / 溶质对在 298 K 下的预测溶剂化自由能。
                    </li>
                    <li>
                        <b>Uncertainty dGsolv298 [kcal/mol]</b>:
                        dGsolv298 预测不确定性，由模型集成预测方差估计。
                    </li>
                    <li>
                        <b>dHsolv298 [kcal/mol]</b>:
                        溶剂 / 溶质对在 298 K 下的预测溶剂化焓。
                    </li>
                    <li>
                        <b>Uncertainty dHsolv298 [kcal/mol]</b>:
                        dHsolv298 预测不确定性，由模型集成预测方差估计。
                    </li>
                    <li>
                        <b>E, S, A, B, L, V</b>:
                        输入溶质的 Abraham 参数预测值。
                    </li>
                </ul>

                <h4 class="text-h6">参考文献</h4>
                <p>
                    Vermeire, F. H.; Chung, Y.; Green, W. H.
                    Predicting Solubility Limits of Organic Solutes for a Wide Range of Solvents and Temperatures.
                    <a href="https://pubs.acs.org/doi/10.1021/jacs.2c01768" target="_blank">ACS Publications</a>
                </p>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn color="primary" variant="tonal" @click="close()">确定</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script>
import { computed } from 'vue'
export default {
    name: "SolubilityModal",
    props: {
        visible: {
            type: Boolean,
            default: false,
        },
    },
    setup(props, context) {
        const propShow = computed({
            get() {
                return props.visible
            },
            set(newVal) {
                context.emit("close-dialog", newVal)
            }
        })

        const close = () => {
            context.emit("close-dialog", false)
        }

        return {
            propShow,
            close
        }
    }
}
</script>
