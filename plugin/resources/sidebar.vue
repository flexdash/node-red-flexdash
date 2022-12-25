<template>
    <v-sheet class="h-100 ma-1">
        <v-tabs v-model="tab">
            <v-tab value="dashboards">Dashs</v-tab>
            <v-tab value="preview">Preview</v-tab>
        </v-tabs>
        <v-window v-model="tab">
            <v-window-item value="dashboards">
                dashboards
            </v-window-item>
            <v-window-item value="preview">
                preview
            </v-window-item>
        </v-window>
    </v-sheet>
</template>

<script>
export default {
    name: 'FDSidebar',
    data: () => ({
        tab: "dashboards",
    }),
}
</script>
