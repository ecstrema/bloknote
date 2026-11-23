<script lang="ts">
  import * as Tabs from "#components/ui/tabs/index.js";
  import AccountsTab from "./accounts-tab.svelte";
</script>

<Tabs.Content value="account">
  <AccountsTab />
</Tabs.Content>