<template>
  <div class="min-h-screen bg-[#080810]">
    <!-- Header Component -->
    <AppHeader
      :is-connected="isConnected"
      :account="account"
      :locale="locale"
      :t="t"
      @connect="handleConnect"
      @disconnect="disconnect"
      @switch-locale="switchLocale"
      @scroll-to="scrollToSection"
    />

    <!-- Hero Banner Section -->
    <div class="hero-section py-8 md:py-12 relative">
      <!-- Dragon decorations -->
      <div class="hero-dragon hero-dragon-left"></div>
      <div class="hero-dragon hero-dragon-right"></div>

      <!-- Decorative lanterns -->
      <img
        src="/decor-lantern.png"
        alt=""
        class="absolute left-4 md:left-12 top-2 w-10 h-10 md:w-14 md:h-14 opacity-60 pointer-events-none"
      />
      <img
        src="/decor-lantern.png"
        alt=""
        class="absolute right-4 md:right-12 top-2 w-10 h-10 md:w-14 md:h-14 opacity-60 pointer-events-none scale-x-[-1]"
        style="animation-delay: 0.5s"
      />

      <div class="container mx-auto px-4 text-center relative z-10">
        <!-- Ornamental top border -->
        <div class="hero-ornament mx-auto mb-4"></div>

        <h2 class="text-4xl md:text-6xl font-serif font-bold text-gold-gradient mb-2 reveal tracking-wider">
          双色球彩票
        </h2>
        <p
          class="text-lg md:text-xl text-[#d4af37] font-medium mb-3 tracking-widest reveal"
          style="animation-delay: 0.1s"
        >
          DoubleBall Lottery
        </p>
        <!-- Ornamental bottom border -->
        <div class="hero-ornament hero-ornament-bottom mx-auto mt-4"></div>
      </div>
    </div>

    <!-- Main Content -->
    <main class="container mx-auto px-4 py-4 md:py-8 min-h-screen relative">
      <!-- Subtle cloud pattern overlay -->
      <div class="fixed inset-0 pointer-events-none bg-clouds z-0"></div>
      <!-- Loading State -->
      <div v-if="loading" class="flex justify-center py-20">
        <Icon name="heroicons:arrow-path" size="xl" class="animate-spin text-[#d4af37]" />
      </div>

      <!-- Main Grid -->
      <div v-else class="grid gap-4 md:gap-6 lg:grid-cols-3">
        <!-- Left Column - Lottery Info -->
        <div class="lg:col-span-2 space-y-4 md:space-y-6">
          <!-- Current Pot Card -->
          <JackpotCard
            :confirmed-pot="currentPot"
            :projected-pot="projectedPot"
            :pending-native-fees="pendingNativeFees"
            :pending-fee-tokens="pendingFeeTokens"
            :estimated-fee-token-bnb="estimatedFeeTokenBnb"
            :fee-token-quote-available="feeTokenQuoteAvailable"
            :current-round="currentRound"
            :total-holders="totalHolders"
            :t="t"
          />

          <!-- Round History Selector -->
          <Card v-if="currentRound > 1n" variant="default">
            <template #header>
              <div class="flex items-center justify-between pb-3 border-b border-[rgba(147,51,234,0.3)]">
                <h2 class="text-lg md:text-xl font-bold text-[#f5f5f7] flex items-center gap-2 md:gap-3">
                  <Icon name="heroicons:clock" size="2xl" class="text-[#a855f7]" />
                  <span>{{ t("app.roundHistory") }}</span>
                </h2>
                <select
                  v-model="selectedRoundId"
                  class="px-3 py-2 border border-[rgba(147,51,234,0.5)] rounded-lg bg-[#1a1a24] text-[#f5f5f7] font-medium focus:border-[#a855f7] focus:outline-none"
                >
                  <option v-for="r in availableRounds" :key="r" :value="r">{{ t("app.round") }} #{{ r }}</option>
                </select>
              </div>
            </template>

            <!-- Loading State -->
            <div v-if="roundDataLoading" class="flex justify-center py-8">
              <Icon name="heroicons:arrow-path" size="xl" class="animate-spin text-[#a855f7]" />
            </div>

            <div v-else-if="selectedRoundData" class="space-y-4">
              <!-- Winning Numbers -->
              <div class="text-center">
                <div class="text-sm font-semibold text-[#a1a1aa] mb-3">{{ t("app.winningNumbers") }}</div>
                <div class="flex justify-center items-center gap-2 md:gap-3 flex-wrap">
                  <div
                    v-for="(ball, idx) in selectedRoundData.redBalls"
                    :key="'hist-red-' + idx"
                    class="lottery-ball lottery-ball-red lottery-ball-sm"
                  >
                    {{ formatBallDisplay(ball) }}
                  </div>
                  <div class="lottery-ball lottery-ball-blue lottery-ball-sm">
                    {{ formatBallDisplay(selectedRoundData.blueBall) }}
                  </div>
                </div>
              </div>

              <!-- Round Stats -->
              <div class="grid grid-cols-2 gap-3 pt-4 border-t border-[rgba(255,255,255,0.08)]">
                <div class="text-center p-3 bg-[#1a1a24] rounded-lg border border-[rgba(147,51,234,0.3)]">
                  <div class="text-xs text-[#a1a1aa]">{{ t("app.potSize") }}</div>
                  <div class="text-lg font-bold text-[#a855f7]">{{ formatBnbDisplay(selectedRoundData.totalPot) }} BNB</div>
                </div>
                <div class="text-center p-3 bg-[#1a1a24] rounded-lg border border-[rgba(147,51,234,0.3)]">
                  <div class="text-xs text-[#a1a1aa]">{{ t("app.status") }}</div>
                  <Badge :variant="selectedRoundData.settled ? 'green' : 'yellow'" size="sm">
                    {{ selectedRoundData.settled ? t("app.settled") : t("app.pending") }}
                  </Badge>
                </div>
              </div>
            </div>
            <div v-else class="text-center py-8 text-[#71717a]">
              {{ t("app.selectRound") }}
            </div>
          </Card>

          <!-- Last Draw Results -->
          <Card v-if="lastDraw && lastDraw.round > 0n" variant="gold" class="overflow-hidden">
            <template #header>
              <div
                class="bg-gradient-to-r from-[#1e90ff] to-[#1565c0] text-white -m-4 md:-m-6 mb-4 md:mb-6 p-4 md:p-6 relative overflow-hidden"
              >
                <div class="absolute inset-0 opacity-10">
                  <img src="/icon-target.png" class="absolute top-2 right-4 w-16 h-16 opacity-50" alt="" />
                </div>
                <h2 class="text-xl md:text-2xl font-bold flex items-center gap-3 relative z-10">
                  <img src="/icon-target.png" class="w-8 h-8 md:w-10 md:h-10" alt="" />
                  <div>
                    <div class="text-xl md:text-2xl">{{ t("app.lastDraw") }}</div>
                    <p class="text-sm opacity-90 font-normal mt-1">
                      {{ t("app.lastDrawRound") }} #{{ lastDraw.round.toString() }}
                    </p>
                  </div>
                </h2>
              </div>
            </template>

            <div class="space-y-4 md:space-y-6">
              <!-- Winning Numbers Display -->
              <div class="text-center py-4">
                <div class="text-sm font-semibold text-[#a1a1aa] mb-4 md:mb-5 uppercase tracking-wide">
                  {{ t("app.winningNumbers") }}
                </div>
                <div class="flex justify-center items-center gap-2 md:gap-4 flex-wrap">
                  <div
                    v-for="(ball, idx) in lastDraw.redBalls"
                    :key="'red-' + idx"
                    class="lottery-ball lottery-ball-red ball-animated"
                  >
                    {{ formatBallDisplay(ball) }}
                  </div>
                  <div class="w-2"></div>
                  <div class="lottery-ball lottery-ball-blue ball-animated">
                    {{ formatBallDisplay(lastDraw.blueBall) }}
                  </div>
                </div>
              </div>

              <!-- User Wins Display -->
              <div
                v-if="isConnected && userWins.length > 0"
                class="border-t border-[rgba(255,255,255,0.08)] pt-4 md:pt-6"
              >
                <div class="bg-[rgba(34,197,94,0.1)] border border-[rgba(34,197,94,0.3)] rounded-xl p-4 md:p-6">
                  <div class="text-center mb-4">
                    <img src="/icon-winner.png" alt="" class="w-16 h-16 md:w-20 md:h-20 mx-auto mb-2" />
                    <h3 class="text-xl md:text-2xl font-bold text-[#22c55e]">{{ t("app.congratulations") }}</h3>
                    <p class="text-[#22c55e]/80">{{ t("app.youWon") }}</p>
                  </div>
                  <div class="space-y-3">
                    <div
                      v-for="(win, idx) in userWins"
                      :key="idx"
                      class="bg-[#1a1a24] rounded-lg p-3 md:p-4 border border-[rgba(34,197,94,0.3)]"
                    >
                      <div class="flex items-center justify-between">
                        <div class="flex-1">
                          <div class="font-bold text-[#f5f5f7]">{{ t("app.ticket") }} #{{ win.ticketIndex + 1 }}</div>
                          <div class="text-sm text-[#a1a1aa]">{{ t(`app.prizeTier${win.tier}`) }}</div>
                        </div>
                        <div class="text-right">
                          <div class="text-lg font-bold text-[#22c55e]">{{ t("app.tier") }} {{ win.tier }}</div>
                          <div class="text-lg md:text-xl font-bold text-[#22c55e] mt-1">
                            {{ win.prizeAmountEth }} BNB
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- No Wins Message -->
              <div
                v-else-if="isConnected && winResultsComplete && lastDrawParticipationCount > 0"
                class="border-t border-[rgba(255,255,255,0.08)] pt-4 md:pt-6"
              >
                <div class="text-center text-[#a1a1aa] py-6 md:py-8">
                  <Icon name="heroicons:x-mark" size="6xl" class="mb-3 opacity-50" />
                  <p class="text-base md:text-lg">{{ t("app.noWins") }}</p>
                </div>
              </div>
            </div>
          </Card>

          <!-- Claims Panel -->
          <div id="claims">
            <ClaimsPanel v-if="isConnected" />
          </div>

          <!-- My Tickets Section -->
          <div id="tickets">
            <Card v-if="isConnected && totalTicketCount > 0" variant="default">
              <template #header>
                <div
                  class="bg-gradient-to-r from-[#c41e3a] to-[#e63946] text-white -m-4 md:-m-6 mb-4 md:mb-6 p-4 md:p-6"
                >
                  <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                      <h3 class="text-xl md:text-2xl font-bold flex items-center gap-3">
                        <Icon name="heroicons:ticket" size="3xl" />
                        <span>{{ t("app.myTickets") }}</span>
                      </h3>
                      <p class="text-sm opacity-90 font-normal mt-1">{{ t("app.clickToEdit") }}</p>
                    </div>
                  </div>
                </div>
              </template>

              <div class="space-y-4 md:space-y-6">
                <!-- Ticket Filters -->
                <div
                  class="flex flex-col sm:flex-row gap-3 p-3 md:p-4 bg-[#1a1a24] rounded-lg border border-[rgba(255,255,255,0.08)]"
                >
                  <div class="flex-1">
                    <label class="text-xs font-medium text-[#a1a1aa] mb-1 block">{{ t("app.filterTickets") }}</label>
                    <select
                      v-model="ticketFilter"
                      class="w-full px-3 py-2 border border-[rgba(255,255,255,0.15)] rounded-lg bg-[#111118] text-[#f5f5f7] text-sm focus:border-[#d4af37] focus:outline-none"
                    >
                      <option value="all">{{ t("app.allTickets") }}</option>
                      <option value="winning">{{ t("app.winningOnly") }}</option>
                      <option value="custom">{{ t("app.customOnly") }}</option>
                    </select>
                  </div>
                  <div class="flex-1">
                    <label class="text-xs font-medium text-[#a1a1aa] mb-1 block">{{ t("app.searchTicket") }}</label>
                    <input
                      v-model="ticketSearch"
                      type="text"
                      :placeholder="t('app.searchPlaceholder')"
                      class="w-full px-3 py-2 border border-[rgba(255,255,255,0.15)] rounded-lg bg-[#111118] text-[#f5f5f7] text-sm focus:border-[#d4af37] focus:outline-none placeholder-[#71717a]"
                    />
                  </div>
                </div>

                <!-- Stats Bar -->
                <div
                  class="flex flex-wrap items-center justify-between gap-2 p-3 md:p-4 bg-[rgba(196,30,58,0.1)] rounded-lg border border-[rgba(196,30,58,0.3)]"
                >
                  <div class="text-base md:text-xl font-bold text-[#f5f5f7]">
                    {{ t("app.totalTickets") }}:
                    <span class="text-[#e63946]">{{ totalTicketCount }}</span>
                  </div>
                  <Badge variant="red" size="md">
                    {{ t("app.showing") }} {{ displayedTickets.length }} / {{ filteredTicketCount }}
                    {{ t("app.tickets") }}
                  </Badge>
                </div>

                <!-- Pagination Controls -->
                <div v-if="totalFilteredPages > 1" class="flex flex-wrap justify-center gap-1 sm:gap-2 md:gap-3">
                  <Button
                    @click="currentPage = 0"
                    :disabled="currentPage === 0"
                    size="sm"
                    variant="outline"
                    class="!px-1.5 sm:!px-2"
                  >
                    <Icon name="heroicons:chevron-double-left" size="sm" />
                  </Button>
                  <Button @click="currentPage--" :disabled="currentPage === 0" size="sm" variant="gold">
                    <Icon name="heroicons:chevron-left" size="sm" class="sm:mr-1" />
                    <span class="hidden sm:inline">{{ t("app.prevPage") }}</span>
                  </Button>
                  <div
                    class="flex items-center px-2 sm:px-3 md:px-6 bg-[#1a1a24] border border-[rgba(255,255,255,0.08)] rounded-lg text-xs sm:text-sm md:text-lg font-semibold text-[#f5f5f7]"
                  >
                    {{ currentPage + 1 }} / {{ totalFilteredPages }}
                  </div>
                  <Button
                    @click="currentPage++"
                    :disabled="currentPage >= totalFilteredPages - 1"
                    size="sm"
                    variant="gold"
                  >
                    <span class="hidden sm:inline">{{ t("app.nextPage") }}</span>
                    <Icon name="heroicons:chevron-right" size="sm" class="sm:ml-1" />
                  </Button>
                  <Button
                    @click="currentPage = totalFilteredPages - 1"
                    :disabled="currentPage >= totalFilteredPages - 1"
                    size="sm"
                    variant="outline"
                    class="!px-1.5 sm:!px-2"
                  >
                    <Icon name="heroicons:chevron-double-right" size="sm" />
                  </Button>
                </div>

                <!-- Tickets Grid -->
                <div v-if="ticketsLoading" class="flex justify-center py-10">
                  <Icon name="heroicons:arrow-path" size="xl" class="animate-spin text-[#d4af37]" />
                </div>

                <div v-else class="grid gap-3 md:gap-6 sm:grid-cols-2">
                  <div
                    v-for="(ticket, index) in displayedTickets"
                    :key="ticket.globalIndex"
                    :class="[
                      'border rounded-xl p-4 md:p-6 bg-[#1a1a24] transition-all',
                      ticket.isWinner
                        ? 'border-[rgba(34,197,94,0.5)]'
                        : ticket.isCustom
                          ? 'border-[rgba(147,51,234,0.5)]'
                          : 'border-[rgba(196,30,58,0.3)] hover:border-[rgba(196,30,58,0.5)]',
                    ]"
                  >
                    <div
                      class="flex items-center justify-between mb-3 md:mb-4 pb-2 md:pb-3 border-b"
                      :class="
                        ticket.isWinner
                          ? 'border-[rgba(34,197,94,0.3)]'
                          : ticket.isCustom
                            ? 'border-[rgba(147,51,234,0.3)]'
                            : 'border-[rgba(196,30,58,0.2)]'
                      "
                    >
                      <div class="text-sm md:text-lg font-bold text-[#f5f5f7]">
                        {{ t("app.ticket") }} #{{ ticket.globalIndex + 1 }}
                      </div>
                      <div class="flex gap-1">
                        <Badge v-if="ticket.isWinner" variant="green" size="sm">{{ t("app.winner") }}</Badge>
                        <Badge v-if="ticket.isCustom" variant="purple" size="sm">{{ t("app.custom") }}</Badge>
                      </div>
                    </div>

                    <!-- Red Balls -->
                    <div class="mb-3 md:mb-5">
                      <div class="text-xs md:text-sm font-semibold text-[#a1a1aa] mb-2 md:mb-3 flex items-center gap-2">
                        <span class="inline-block w-2 h-2 md:w-3 md:h-3 rounded-full bg-[#c41e3a]"></span>
                        {{ t("app.redBalls") }}
                      </div>
                      <div class="flex gap-1 md:gap-3 flex-wrap">
                        <div
                          v-for="(ball, idx) in ticket.redBalls"
                          :key="idx"
                          :class="[
                            'lottery-ball lottery-ball-red lottery-ball-sm',
                            canCompareDisplayedTicketsToLastDraw && lastDraw.redBalls.includes(ball)
                              ? 'ring-2 ring-[#d4af37] ring-offset-1 ring-offset-[#1a1a24]'
                              : '',
                          ]"
                        >
                          {{ formatBallDisplay(ball) }}
                        </div>
                      </div>
                    </div>

                    <!-- Blue Ball -->
                    <div class="mb-3 md:mb-5">
                      <div class="text-xs md:text-sm font-semibold text-[#a1a1aa] mb-2 md:mb-3 flex items-center gap-2">
                        <span class="inline-block w-2 h-2 md:w-3 md:h-3 rounded-full bg-[#1e90ff]"></span>
                        {{ t("app.blueBall") }}
                      </div>
                      <div
                        :class="[
                          'lottery-ball lottery-ball-blue lottery-ball-sm',
                          canCompareDisplayedTicketsToLastDraw && lastDraw.blueBall === ticket.blueBall
                            ? 'ring-2 ring-[#d4af37] ring-offset-1 ring-offset-[#1a1a24]'
                            : '',
                        ]"
                      >
                        {{ formatBallDisplay(ticket.blueBall) }}
                      </div>
                    </div>

                    <!-- Edit Button -->
                    <div
                      class="mt-3 md:mt-4 pt-3 md:pt-4 border-t"
                      :class="
                        ticket.isWinner
                          ? 'border-[rgba(34,197,94,0.3)]'
                          : ticket.isCustom
                            ? 'border-[rgba(147,51,234,0.3)]'
                            : 'border-[rgba(196,30,58,0.2)]'
                      "
                    >
                      <Button
                        @click="openEditDialog(ticket.globalIndex, ticket)"
                        block
                        variant="outline"
                        size="sm"
                        class="font-bold"
                      >
                        <Icon name="heroicons:pencil" class="mr-2" />
                        {{ t("app.editNumbers") }}
                      </Button>
                    </div>
                  </div>
                </div>

                <!-- Empty filtered state -->
                <div v-if="displayedTickets.length === 0 && totalTicketCount > 0" class="text-center py-8">
                  <Icon name="heroicons:magnifying-glass-circle" size="5xl" class="text-[#a1a1aa] mb-3" />
                  <p class="text-[#a1a1aa]">{{ t("app.noMatchingTickets") }}</p>
                  <Button
                    @click="
                      ticketFilter = 'all';
                      ticketSearch = '';
                    "
                    variant="outline"
                    size="sm"
                    class="mt-3"
                  >
                    {{ t("app.clearFilters") }}
                  </Button>
                </div>
              </div>
            </Card>
          </div>

          <!-- How to Play -->
          <Card variant="gold" class="card-luxury overflow-hidden">
            <template #header>
              <div class="header-imperial text-white -m-6 mb-4 p-4 md:p-6 relative">
                <h2 class="text-xl md:text-2xl font-bold flex items-center gap-3 relative z-10 tracking-wide">
                  <Icon name="heroicons:clipboard-document" size="3xl" />
                  <div>{{ t("app.howToPlay") }}</div>
                </h2>
              </div>
            </template>

            <div class="space-y-4 md:space-y-5 stagger-reveal">
              <div
                class="step-card flex gap-3 md:gap-4 p-4 md:p-5 rounded-xl border border-[rgba(212,175,55,0.2)] reveal"
              >
                <div
                  class="flex-shrink-0 w-12 h-12 md:w-14 md:h-14 rounded-full bg-gradient-to-br from-[#9a1830] via-[#c41e3a] to-[#e63946] text-white flex items-center justify-center font-bold text-xl md:text-2xl border-2 border-[rgba(212,175,55,0.5)] font-serif"
                >
                  壹
                </div>
                <div class="pt-1">
                  <h3 class="font-bold text-[#f5d066] mb-1 md:mb-2 text-base md:text-lg">
                    {{ t("app.step1Title") }}
                  </h3>
                  <p class="text-[#a1a1aa] text-sm md:text-base leading-relaxed">{{ t("app.step1Text") }}</p>
                </div>
              </div>

              <div
                class="step-card flex gap-3 md:gap-4 p-4 md:p-5 rounded-xl border border-[rgba(212,175,55,0.2)] reveal"
              >
                <div
                  class="flex-shrink-0 w-12 h-12 md:w-14 md:h-14 rounded-full bg-gradient-to-br from-[#9a1830] via-[#c41e3a] to-[#e63946] text-white flex items-center justify-center font-bold text-xl md:text-2xl border-2 border-[rgba(212,175,55,0.5)] font-serif"
                >
                  贰
                </div>
                <div class="pt-1">
                  <h3 class="font-bold text-[#f5d066] mb-1 md:mb-2 text-base md:text-lg">
                    {{ t("app.step2Title") }}
                  </h3>
                  <p class="text-[#a1a1aa] text-sm md:text-base leading-relaxed">{{ t("app.step2Text") }}</p>
                </div>
              </div>

              <div
                class="step-card flex gap-3 md:gap-4 p-4 md:p-5 rounded-xl border border-[rgba(212,175,55,0.2)] reveal"
              >
                <div
                  class="flex-shrink-0 w-12 h-12 md:w-14 md:h-14 rounded-full bg-gradient-to-br from-[#9a1830] via-[#c41e3a] to-[#e63946] text-white flex items-center justify-center font-bold text-xl md:text-2xl border-2 border-[rgba(212,175,55,0.5)] font-serif"
                >
                  叁
                </div>
                <div class="pt-1">
                  <h3 class="font-bold text-[#f5d066] mb-1 md:mb-2 text-base md:text-lg">
                    {{ t("app.step3Title") }}
                  </h3>
                  <p class="text-[#a1a1aa] text-sm md:text-base leading-relaxed">{{ t("app.step3Text") }}</p>
                </div>
              </div>
            </div>
          </Card>
        </div>

        <!-- Right Column - User Info & Actions -->
        <div class="space-y-4 md:space-y-6">
          <!-- Countdown Timer -->
          <CountdownTimer
            :blocks-remaining="blocksUntilDraw"
            :total-blocks="lotteryInterval"
            :draw-ready="canStartLottery"
          />

          <!-- User Stats -->
          <UserStatsCard
            v-if="isConnected"
            :balance-in-tokens="balanceInTokens"
            :ticket-count="userTicketCount"
            :t="t"
          />

          <!-- Connect Prompt -->
          <Card v-else variant="gold" class="card-luxury overflow-hidden">
            <template #header>
              <div class="header-imperial text-white -m-6 mb-4 p-4 md:p-6 relative">
                <h2 class="text-lg md:text-xl font-bold tracking-wide relative z-10">
                  {{ t("app.getStarted") }}
                </h2>
              </div>
            </template>

            <div class="text-center py-8 md:py-10 relative">
              <div class="absolute inset-0 dragon-watermark"></div>
              <div class="relative z-10">
                <Icon name="heroicons:ticket" size="6xl" class="text-[#d4af37] mb-4 md:mb-6 pulse-glow" />
                <p class="text-[#a1a1aa] mb-4 font-medium text-base md:text-lg">{{ t("app.getStartedDesc") }}</p>
                <Button
                  @click="handleConnect"
                  size="lg"
                  block
                  variant="gold"
                  class="font-bold py-3 md:py-4 px-6 md:px-8 text-base md:text-lg btn-gold-luxury"
                >
                  {{ t("app.connect") }}
                </Button>
              </div>
            </div>
          </Card>

          <!-- Live Activity Feed -->
          <LiveActivityFeed />

          <!-- Admin Panel (only visible to owner) -->
          <AdminPanel />
        </div>
      </div>
    </main>

    <!-- Edit Ticket Modal -->
    <ClientOnly>
      <TicketsModal
        v-model="showEditDialog"
        :ticket-index="editingTicketIndex"
        :ticket="editingTicket"
        @tickets-updated="handleTicketsUpdated"
      />
    </ClientOnly>

    <ClientOnly>
      <WalletPickerModal
        v-model="showWalletPicker"
        :providers="providers"
        :discovery-state="discoveryState"
        :connecting-provider-id="connectingProviderId"
        :is-connecting="isConnecting"
        @select="handleWalletSelected"
        @refresh="handleRefreshProviders"
      />
    </ClientOnly>

    <!-- Toast Container -->
    <ClientOnly>
      <ToastContainer />
    </ClientOnly>
  </div>
</template>

<script setup lang="ts">
import { useWeb3 } from "../../composables/useWeb3";
import { useLottery } from "../../composables/useLottery";
import { ref, shallowRef, computed, watch, onMounted, onUnmounted } from "vue";
import { formatBallDisplay, formatBnbDisplay } from "../../composables/useDisplayFormat";
import { useTranslation } from "../../composables/useTranslation";
import { useToast } from "../../composables/useToast";
import { getWalletErrorMessage } from "../../composables/useWalletErrorMessage";

import Button from "../components/ui/Button.vue";
import Card from "../components/ui/Card.vue";
import Badge from "../components/ui/Badge.vue";
import CountdownTimer from "../components/CountdownTimer.vue";
import TicketsModal from "../components/TicketsModal.vue";
import ToastContainer from "../components/ui/ToastContainer.vue";
import ClaimsPanel from "../components/ClaimsPanel.vue";
import AppHeader from "../components/AppHeader.vue";
import JackpotCard from "../components/JackpotCard.vue";
import UserStatsCard from "../components/UserStatsCard.vue";
import AdminPanel from "../components/AdminPanel.vue";
import LiveActivityFeed from "../components/LiveActivityFeed.vue";
import WalletPickerModal from "../components/WalletPickerModal.vue";

const g: any = globalThis as any;

// Cleanup refs - must be inside setup for proper scoping
const visibilityHandler = ref<(() => void) | null>(null);
const searchDebounceTimer = ref<ReturnType<typeof setTimeout> | null>(null);

const { t, locale, setLocale } = useTranslation();
const {
  account,
  isConnected,
  providers,
  discoveryState,
  connectingProviderId,
  isConnecting,
  requestProviders,
  connect,
  disconnect,
} = useWeb3();
const {
  loading,
  lotteryEnabled,
  canStartLottery,
  lotteryInterval,
  currentRound,
  latestDrawnRoundId,
  recentDrawnRoundIds,
  currentPot,
  projectedPot,
  pendingNativeFees,
  pendingFeeTokens,
  estimatedFeeTokenBnb,
  feeTokenQuoteAvailable,
  userBalance,
  userTicketCount,
  totalHolders,
  blocksUntilDraw,
  potInBNB,
  balanceInTokens,
  lastFetchTime,
  fetchLotteryState,
  startPolling,
  stopPolling,
  getLastDrawResult,
  getPrizeTierName,
  getRoundResult,
} = useLottery();

const toast = useToast();
const showEditDialog = ref(false);
const showWalletPicker = ref(false);
const editingTicketIndex = ref<number | null>(null);
const editingTicket = ref<any>(null);

// Last draw and wins
const lastDraw = ref<any>(null);
const userWins = ref<
  {
    ticketIndex: number;
    tier: number;
    prizeAmount: string;
    prizeAmountEth: string;
    claimed: boolean;
    redBalls: number[];
    blueBall: number;
  }[]
>([]);
const winResultsComplete = ref(false);
const lastDrawParticipationCount = ref(0);
let pendingWinFetch: { key: string; promise: Promise<void> } | null = null;

// Ticket filters
const ticketFilter = ref<"all" | "winning" | "custom">("all");
const ticketSearch = ref("");
const currentPage = ref(0);
const pageSize = 10;

// Round history
const selectedRoundId = ref<number | null>(null);
const selectedRoundData = ref<any>(null);
const roundDataLoading = ref(false);
const ticketFetchRequestId = ref(0);
const winFetchRequestId = ref(0);

// Available rounds for history
const availableRounds = computed(() => {
  return recentDrawnRoundIds.value.map(Number);
});

// Server-side paginated tickets (don't store all 500k tickets in memory!)
const displayedTickets = shallowRef<any[]>([]);
const totalTicketCount = ref(0);
const filteredTicketCount = ref(0);
const displayedTicketRoundId = ref<bigint | null>(null);
const totalFilteredPages = computed(() => {
  if (filteredTicketCount.value < 0) return 1;
  return Math.ceil(filteredTicketCount.value / pageSize);
});
const ticketsLoading = ref(false);
const canCompareDisplayedTicketsToLastDraw = computed(() => {
  return !!lastDraw.value && displayedTicketRoundId.value === lastDraw.value.round;
});

// Fetch paginated tickets from API (server does filtering/pagination)
const fetchPaginatedTickets = async () => {
  if (!account.value || !isConnected.value) {
    displayedTickets.value = [];
    totalTicketCount.value = 0;
    filteredTicketCount.value = 0;
    displayedTicketRoundId.value = null;
    ticketsLoading.value = false;
    return;
  }

  const requestId = ++ticketFetchRequestId.value;
  const requestedAccount = account.value;

  try {
    ticketsLoading.value = true;
    const response = await $fetch<{
      success: boolean;
      ticketCount: number;
      filteredCount: number;
      page: number;
      limit: number;
      totalPages: number;
      roundId: number;
      tickets: {
        index: number;
        redBalls: number[];
        blueBall: number;
        isCustom: boolean;
        isWinner?: boolean;
      }[];
    }>("/api/user-tickets", {
      query: {
        address: requestedAccount,
        roundId: currentRound.value.toString(),
        page: currentPage.value,
        limit: pageSize,
        filter: ticketFilter.value,
        search: ticketSearch.value.trim(),
      },
    });

    if (requestId !== ticketFetchRequestId.value) {
      return;
    }

    if (!isConnected.value || !account.value || account.value !== requestedAccount) {
      return;
    }

    if (response?.success) {
      totalTicketCount.value = response.ticketCount;
      filteredTicketCount.value = response.filteredCount ?? response.ticketCount;
      displayedTicketRoundId.value = BigInt(response.roundId);
      displayedTickets.value = response.tickets.map((t) => ({
        globalIndex: t.index,
        redBalls: t.redBalls,
        blueBall: t.blueBall,
        isCustom: t.isCustom,
        isWinner: t.isWinner ?? false,
      }));
    }
  } catch (err) {
    console.error("Failed to fetch paginated tickets:", err);
  } finally {
    if (requestId === ticketFetchRequestId.value) {
      ticketsLoading.value = false;
    }
  }
};

// Reset page and refetch when filter changes (immediate)
watch(ticketFilter, () => {
  currentPage.value = 0;
  fetchPaginatedTickets();
});

// Debounced search to avoid excessive API calls while typing
watch(ticketSearch, () => {
  currentPage.value = 0;
  if (searchDebounceTimer.value) clearTimeout(searchDebounceTimer.value);
  searchDebounceTimer.value = setTimeout(() => {
    searchDebounceTimer.value = null;
    fetchPaginatedTickets();
  }, 300); // 300ms debounce
});

// Refetch when page changes
watch(currentPage, () => {
  fetchPaginatedTickets();
});

// Fetch round data when selected
watch(
  selectedRoundId,
  async (roundId) => {
    if (roundId && roundId > 0) {
      roundDataLoading.value = true;
      try {
        selectedRoundData.value = await getRoundResult(BigInt(roundId));
      } finally {
        roundDataLoading.value = false;
      }
    } else {
      selectedRoundData.value = null;
    }
  },
  { immediate: true },
);

// Auto-select the latest round that actually has winning numbers.
watch(
  latestDrawnRoundId,
  (newRound) => {
    if (newRound !== null && newRound >= 1n) {
      if (selectedRoundId.value === null) {
        selectedRoundId.value = Number(newRound);
      }
      else if (selectedRoundId.value > Number(newRound)) {
        selectedRoundId.value = Number(newRound);
      }
    } else {
      selectedRoundId.value = null;
    }
  },
  { immediate: true },
);

// Methods
const switchLocale = (newLocale: string) => {
  setLocale(newLocale);
};

const formatBalance = (balance: string) => {
  const num = parseFloat(balance);
  if (num > 1000000) return `${(num / 1000000).toFixed(2)}M`;
  if (num > 1000) return `${(num / 1000).toFixed(2)}K`;
  return num.toFixed(2);
};

const scrollToSection = (id: string) => {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
};

const handleConnect = async () => {
  showWalletPicker.value = true;
  try {
    await requestProviders();
  } catch (error: any) {
    toast.error(t("app.connectionFailed"), getWalletErrorMessage(error));
  }
};

const handleRefreshProviders = async () => {
  try {
    await requestProviders();
  } catch (error: any) {
    toast.error(t("app.connectionFailed"), getWalletErrorMessage(error));
  }
};

const handleWalletSelected = async (providerId: string) => {
  if (isConnecting.value) return;

  try {
    await connect(providerId);
    showWalletPicker.value = false;
    await fetchLotteryState();
    toast.success(t("app.walletConnected"));
  } catch (error: any) {
    toast.error(
      t("app.connectionFailed"),
      getWalletErrorMessage(error, {
        rejectedMessage: t("app.connectionRejected"),
        fallbackMessage: t("app.connectionFailed"),
      }),
    );
  }
};

const handleTicketsUpdated = async () => {
  // Refresh paginated tickets after edit
  await fetchPaginatedTickets();
};

const openEditDialog = (ticketIndex: number, ticket: any) => {
  editingTicketIndex.value = ticketIndex;
  editingTicket.value = ticket;
  showEditDialog.value = true;
};

const performLastDrawAndCheckWinsFetch = async () => {
  const requestId = ++winFetchRequestId.value;
  const requestedAccount = account.value;
  winResultsComplete.value = false;
  lastDrawParticipationCount.value = 0;

  try {
    const draw = await getLastDrawResult();
    if (requestId !== winFetchRequestId.value) {
      return;
    }
    lastDraw.value = draw;

    if (!draw || !isConnected.value || !requestedAccount || account.value !== requestedAccount) {
      userWins.value = [];
      return;
    }

    const response = await $fetch<{
      success: boolean;
      complete: boolean;
      participationTicketCount?: number;
      tickets: {
        ticketIndex: number;
        tier: number;
        prizeAmount: string;
        prizeAmountEth: string;
        claimed: boolean;
        redBalls: number[];
        blueBall: number;
      }[];
    }>("/api/user-wins-tickets", {
      query: {
        address: requestedAccount,
        roundId: draw.round.toString(),
        page: 0,
        limit: 100,
        includeParticipation: true,
      },
    });

    if (requestId !== winFetchRequestId.value) {
      return;
    }
    if (!isConnected.value || !account.value || account.value !== requestedAccount) {
      return;
    }

    userWins.value = response?.success && response.complete ? response.tickets : [];
    winResultsComplete.value = response?.success && response.complete;
    lastDrawParticipationCount.value = response?.participationTicketCount ?? 0;
  } catch (err) {
    console.error("Error fetching last draw:", err);
  }
};

const fetchLastDrawAndCheckWins = (): Promise<void> => {
  const key = `${account.value ?? "disconnected"}:${latestDrawnRoundId.value?.toString() ?? "none"}`;
  if (pendingWinFetch?.key === key) return pendingWinFetch.promise;

  let promise: Promise<void>;
  promise = performLastDrawAndCheckWinsFetch().finally(() => {
    if (pendingWinFetch?.promise === promise) pendingWinFetch = null;
  });
  pendingWinFetch = { key, promise };
  return promise;
};

// Watchers
watch(
  [isConnected, account, currentRound],
  async ([connected, _account, roundId]) => {
    if (connected && _account && roundId >= 1n) {
      await fetchPaginatedTickets();
    } else if (!connected || !_account) {
      displayedTickets.value = [];
      totalTicketCount.value = 0;
      filteredTicketCount.value = 0;
      displayedTicketRoundId.value = null;
      userWins.value = [];
      winResultsComplete.value = false;
      lastDrawParticipationCount.value = 0;
      ticketFetchRequestId.value += 1;
      winFetchRequestId.value += 1;
    }
  },
  { immediate: true },
);

watch(
  [isConnected, account, latestDrawnRoundId],
  async ([connected, connectedAccount, newRound]) => {
    if (connected && connectedAccount && newRound !== null) {
      await fetchLastDrawAndCheckWins();
    } else {
      lastDraw.value = null;
      userWins.value = [];
      winResultsComplete.value = false;
      lastDrawParticipationCount.value = 0;
    }
  },
  { immediate: true },
);

watch(
  lastFetchTime,
  async () => {
    if (isConnected.value && latestDrawnRoundId.value !== null && !winResultsComplete.value) {
      await fetchLastDrawAndCheckWins();
    }
  },
);

onMounted(async () => {
  if (!g?.window) return;

  // Handle visibility changes
  if (g?.document) {
    if (g.document.visibilityState !== "hidden") {
      startPolling(30000);
    }
    visibilityHandler.value = () => {
      if (g.document.visibilityState === "hidden") {
        stopPolling();
      } else {
        startPolling(30000);
      }
    };
    g.document.addEventListener("visibilitychange", visibilityHandler.value);
  }
});

onUnmounted(() => {
  // Clear polling interval
  stopPolling();

  // Clear search debounce timer
  if (searchDebounceTimer.value) {
    clearTimeout(searchDebounceTimer.value);
    searchDebounceTimer.value = null;
  }

  // Remove visibility change listener
  if (g?.document && visibilityHandler.value) {
    g.document.removeEventListener("visibilitychange", visibilityHandler.value);
    visibilityHandler.value = null;
  }
});
</script>

<style scoped>
/* Copy icon transition */
.copy-icon-enter-active {
  animation: copy-icon-in 0.15s ease-out;
}

.copy-icon-leave-active {
  animation: copy-icon-out 0.1s ease-in;
}

@keyframes copy-icon-in {
  0% {
    opacity: 0;
    transform: scale(0.8);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes copy-icon-out {
  0% {
    opacity: 1;
    transform: scale(1);
  }
  100% {
    opacity: 0;
    transform: scale(0.8);
  }
}
</style>
