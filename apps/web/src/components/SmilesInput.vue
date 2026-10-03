<template>
    <v-form>
        <v-text-field :id="id" v-model="smiles" :disabled="disabled" :rules="required ? requiredRule : []"
            append-icon="mdi-pencil" @click:append="openModal"></v-text-field>
        <v-dialog v-model="modalOpen" max-width="500px">
            <KetcherModal :id="modalId" :smiles="smiles" @close="closeModal" />
        </v-dialog>
    </v-form>
</template>

<script>
import KetcherModal from '@/components/KetcherModal'

export default {
    components: {
        KetcherModal
    },

    data() {
        return {
            modalOpen: false
        }
    },

    methods: {
        openModal() {
            this.modalOpen = true
        },
        closeModal() {
            this.modalOpen = false
        }
    },

    props: {
        id: {
            type: String,
            default: ''
        },
        value: {
            type: String,
            default: ''
        },
        disabled: {
            type: Boolean,
            default: false
        },
        required: {
            type: Boolean,
            default: false
        }
    },

    computed: {
        buttonId() {
            return `edit-btn-${this.id}`
        },
        modalId() {
            return `ketcher-modal-${this.id}`
        },
        requiredRule() {
            return [v => !!v || 'Required']
        },
        smiles: {
            get() {
                return this.value
            },
            set(value) {
                this.$emit('input', value)
            }
        }
    }
}
</script>