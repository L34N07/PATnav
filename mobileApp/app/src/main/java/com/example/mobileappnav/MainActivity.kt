package com.example.mobileappnav

import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.TableRow
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.isVisible
import com.example.mobileappnav.databinding.ActivityMainBinding
import kotlin.math.roundToInt

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    private val sampleNames = listOf(
        "Lucia" to "Torres",
        "Mateo" to "Alvarez",
        "Camila" to "Quiroga",
        "Sofia" to "Delgado",
        "Ismael" to "Costa",
        "Valentina" to "Rios"
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.loadNamesButton.setOnClickListener {
            if (!binding.namesTable.isVisible) {
                populateNamesTable()
            }
        }
    }

    private fun populateNamesTable() {
        val table = binding.namesTable
        table.removeAllViews()

        table.addView(
            createRow(
                getString(R.string.first_name_header),
                getString(R.string.last_name_header),
                isHeader = true
            )
        )

        sampleNames.forEach { (firstName, lastName) ->
            table.addView(createRow(firstName, lastName, isHeader = false))
        }

        table.visibility = View.VISIBLE
        binding.loadNamesButton.text = getString(R.string.names_loaded)
    }

    private fun createRow(firstName: String, lastName: String, isHeader: Boolean): TableRow {
        val row = TableRow(this)
        row.layoutParams = TableRow.LayoutParams(
            TableRow.LayoutParams.MATCH_PARENT,
            TableRow.LayoutParams.WRAP_CONTENT
        )

        val horizontalPadding = 16.dpToPx()
        val verticalPadding = 12.dpToPx()

        val firstNameCell = createCell(firstName, isHeader, horizontalPadding, verticalPadding)
        val lastNameCell = createCell(lastName, isHeader, horizontalPadding, verticalPadding)

        row.addView(firstNameCell)
        row.addView(lastNameCell)

        val backgroundColor = if (isHeader) {
            ContextCompat.getColor(this, R.color.blue_primary)
        } else {
            ContextCompat.getColor(this, R.color.table_row_background)
        }
        row.setBackgroundColor(backgroundColor)

        return row
    }

    private fun createCell(
        value: String,
        isHeader: Boolean,
        horizontalPadding: Int,
        verticalPadding: Int
    ): TextView {
        return TextView(this).apply {
            text = value
            layoutParams = TableRow.LayoutParams(0, TableRow.LayoutParams.WRAP_CONTENT, 1f)
            setPadding(horizontalPadding, verticalPadding, horizontalPadding, verticalPadding)
            textSize = if (isHeader) 16f else 15f
            typeface = if (isHeader) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
            gravity = Gravity.START
            setTextColor(
                if (isHeader) ContextCompat.getColor(this@MainActivity, R.color.white)
                else ContextCompat.getColor(this@MainActivity, R.color.black)
            )
        }
    }

    private fun Int.dpToPx(): Int = (this * resources.displayMetrics.density).roundToInt()
}
