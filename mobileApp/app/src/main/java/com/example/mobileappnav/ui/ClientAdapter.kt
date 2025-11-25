package com.example.mobileappnav.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.example.mobileappnav.databinding.ItemClientBinding
import com.example.mobileappnav.model.Client

class ClientAdapter(
    private val clients: MutableList<Client>,
    private val onClientSelected: (client: Client, position: Int) -> Unit
) : RecyclerView.Adapter<ClientAdapter.ClientViewHolder>() {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ClientViewHolder {
        val binding = ItemClientBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ClientViewHolder(binding)
    }

    override fun getItemCount(): Int = clients.size

    override fun onBindViewHolder(holder: ClientViewHolder, position: Int) {
        holder.bind(clients[position])
    }

    fun updateClient(position: Int, updated: Client) {
        clients[position] = updated
        notifyItemChanged(position)
    }

    inner class ClientViewHolder(
        private val binding: ItemClientBinding
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(client: Client) {
            binding.clientNameText.text = client.name
            binding.clientSummaryText.text = summaryFor(client)
            binding.root.setOnClickListener {
                onClientSelected(client, bindingAdapterPosition)
            }
        }

        private fun summaryFor(client: Client): String =
            "x10: ${client.x10} | x20: ${client.x20} | 10L: ${client.tenLiters} | 20L: ${client.twentyLiters}"
    }
}
